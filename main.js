const vsSource = `
attribute vec4 aVertexPosition;
void main() {
    gl_Position = aVertexPosition;
}
`;

const fsSource = `
uniform mediump vec2 uResolution;
uniform mediump float uTime;
uniform mediump float uFrequency;

// 1D texture containing 16 3D gradient vectors encoded in the
// RGB color channels.
uniform sampler2D uGradientSampler;

// One dimensional texture containing a permutation of integers 0..255,
// encoded in the alpha channel.
uniform sampler2D uPermSampler;

// Input should be in (0, 1).
lowp float hash(float x) {
    lowp float qx = x;
    // Just gonna let the interpolation happen here.
    // There are no mistakes, just happy accidents
    //qx = floor(qx * 256.0) / 256.0;
    lowp vec4 sample = texture2D(uPermSampler, vec2(qx, 0.0));
    return sample.w;
}
lowp float hash2(vec2 v) {
    return hash(fract(hash(v.x) + v.y));
}
lowp float hash3(vec3 v) {
    return hash(fract(hash2(v.xy) + v.z));
}

lowp vec3 grad(lowp float x) {
    lowp float qx = x;
    // Despite Ken Perlin's observation that selecting from a small finite set
    // of gradients is sufficient to produce a random-looking texture, allowing
    // texture sampling interpolation to occur seems to lend a more natural
    // appearance.
    // TODO This smells fishy to me. Should investigate.
    //qx = floor(x * 16.0) / 16.0;
    lowp vec4 sample = texture2D(uGradientSampler, vec2(qx, 0.0));
    return sample.xyz * 256.0 - 1.0; // rehydrating from unsigned integer values
}

lowp float g(vec3 i, vec3 p, vec3 offset, float scale) {
    lowp float h = hash3((i+offset)/scale);
    lowp vec3 g = grad(h);
    return dot(g, p - offset);
}

mediump vec3 fade(mediump vec3 t) {
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

mediump vec3 lfade(mediump vec3 t) {
    return t;
}

mediump float lerp(float a, float b, float x) {
    return mix(a, b, x);
}

void main() {
    mediump vec2 uv = gl_FragCoord.xy / uResolution;

    //mediump float z = 0.8; // Z-coordinate is fixed for 2D slice of 3D noise.
    mediump float z = fract(uTime * uFrequency);

    mediump float s = 20.0; // Integer grid size.
    mediump float u = 1.0/s; // Unit size.

    mediump vec3 i = vec3(floor(uv * s), floor(z * s)); // Coordinates of integer grid square.
    mediump vec3 p = vec3(fract(uv * s), fract(z * s)); // Coordinates of pixel within integer grid square.

    mediump vec3 f = fade(p);
    lowp float v =
       lerp( 
            lerp(
                lerp(g(i, p, vec3(0.0,0.0,0.0), s), g(i, p, vec3(1.0,0.0,0.0), s), f.x),
                lerp(g(i, p, vec3(0.0,1.0,0.0), s), g(i, p, vec3(1.0,1.0,0.0), s), f.x), f.y),
            lerp(
                lerp(g(i, p, vec3(0.0,0.0,1.0), s), g(i, p, vec3(1.0,0.0,1.0), s), f.x),
                lerp(g(i, p, vec3(0.0,1.0,1.0), s), g(i, p, vec3(1.0,1.0,1.0), s), f.x), f.y), f.z);

    // Noise range is (-sqrt(3)/2, sqrt(3)/2); normalizing.
    // Reference: https://eev.ee/blog/2016/05/29/perlin-noise/#some-properties
    v = (v + 0.866) / 1.732;
    gl_FragColor = vec4(v, v, v, 1.0);
}
`;

const PERLIN_PERM = new Uint8Array([
    174,110, 47,235,119,  9,247,218, 89, 60,206, 50,213, 77,129, 59,
    201,238,117,139, 93,177,115,124,  0,227, 23,251, 20, 76,109,156,
     71,151, 10,202, 51,122,210,137, 38, 97,231,  7,194, 42,140, 39,
    121,185,147, 73,205,176,183,146,107, 12,179,198,154, 11, 45,118,
    123, 94,204,226,  1, 63,148,113,164,  6, 24,192, 72,229,254, 48,
    253,172, 52,223,222, 79, 78,171, 19, 32,155,249,233, 35,208,127,
     33, 21,165,219,228,250, 99, 61,157, 22,125, 81,242,207,163,255,
    108,138, 54,130, 36,232,182,101,191,132, 17,168,246,188, 95,136,
      8,215,178,166, 43,114, 68,135,193, 70,104, 91,220,190,133, 86,
    209,145,131, 85,241,106, 14,112,150,252,  5, 96,141, 64,103,217,
    199,225,  3, 75,153, 57,195, 84,243,159,186,245,120,161,100,234,
    216,144, 56,142,230, 66,187, 69, 90, 44,248,240,105,170, 49, 31,
    196,197,  4, 88, 18,162,181, 58,152, 83, 62, 74,116,126,211,102,
    214,  2,244,160, 16,180,236,169, 25, 46,128,239, 41, 30,167, 67,
    212,175, 28, 82,224,221,111, 13, 87, 55, 80,200,189,134,184, 27,
     29,173,203, 65, 53, 26,158,237,149, 34, 98, 15, 37, 40,143, 92
]);

const PERLIN_GRADIENTS = new Int8Array([
    1,1,0,    -1,1,0,    1,-1,0,    -1,-1,0,
    1,0,1,    -1,0,1,    1,0,-1,    -1,0,-1,
    0,1,1,    0,-1,1,    0,1,-1,    0,-1,-1,
    1,1,0,    0,-1,1,    -1,1,0,    0,-1,-1,
]);

var frequency = 1/16;

// Given an array of indices, return an array of the 3D gradients for each
// index. Array access wraps around.
function permuteGradients(p, g) {
    result = new Uint8Array(3 * p.length);
    for (var i = 0; i < p.length; i++) {
        gi = p[i] * 3 % g.length;
        result[i] = g[gi];
        result[i+1] = g[gi+1];
        result[i+2] = g[gi+2];
    }
    return result;
}

function initShaderProgram(gl, vs, fs) {
    const vertexShader = loadShader(gl, gl.VERTEX_SHADER, vs);
    const fragmentShader = loadShader(gl, gl.FRAGMENT_SHADER, fs);

    const shaderProgram = gl.createProgram();
    gl.attachShader(shaderProgram, vertexShader);
    gl.attachShader(shaderProgram, fragmentShader);
    gl.linkProgram(shaderProgram);

    if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
        alert('unable to init shader program: ' + gl.getProgramInfoLog(shaderProgram));
        return null;
    }

    return shaderProgram;
}

function loadShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        alert('shader compilation error: ' + gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

function initBuffers(gl) {
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);

    const positions = [
        -1.0, -1.0,
        -1.0,  1.0,
         1.0,  1.0,
         1.0, -1.0,
    ];

    gl.bufferData(gl.ARRAY_BUFFER,
                  new Float32Array(positions),
                  gl.STATIC_DRAW);

    return {
        position: positionBuffer,
    };
}

function drawScene(gl, programInfo, buffers, time) {
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clearDepth(1.0);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.position);
    gl.vertexAttribPointer(
        programInfo.attribLocations.vertexPosition,
        2,        // numComponents
        gl.FLOAT, // type
        false,    // normalize
        0,        // stride
        0);       // offset
    gl.enableVertexAttribArray(programInfo.attribLocations.vertexPosition);

    gl.useProgram(programInfo.program);

    bufferDimensions = [gl.drawingBufferWidth, gl.drawingBufferHeight];
    gl.uniform2fv(programInfo.uniformLocations.resolution, bufferDimensions);

    { // permute sampler
        gl.activeTexture(gl.TEXTURE0);

        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);

        const level = 0;
        const internalFormat = gl.ALPHA;
        const width = 256;
        const height = 1;
        const border = 0;
        const srcFormat = gl.ALPHA;
        const srcType = gl.UNSIGNED_BYTE;
        const pixel = PERLIN_PERM;

        gl.texImage2D(
            gl.TEXTURE_2D, level, internalFormat,
            width, height, border, srcFormat, srcType,
            pixel);

        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
    {
        gl.activeTexture(gl.TEXTURE1);

        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);

        const level = 0;
        const internalFormat = gl.RGB;
        const width = 16;
        const height = 1;
        const border = 0;
        const srcFormat = gl.RGB;
        const srcType = gl.UNSIGNED_BYTE;
        const pixel = Uint8Array.from(PERLIN_GRADIENTS.map(x => (x + 1)));

        gl.texImage2D(
            gl.TEXTURE_2D, level, internalFormat,
            width, height, border, srcFormat, srcType,
            pixel);

        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }

    gl.uniform1i(programInfo.uniformLocations.permSampler, 0);
    gl.uniform1i(programInfo.uniformLocations.gradientSampler, 1);

    gl.uniform1f(programInfo.uniformLocations.time, time);
    gl.uniform1f(programInfo.uniformLocations.frequency, frequency); // global

    {
        const offset = 0;
        const vertexCount = 4;
        gl.drawArrays(gl.TRIANGLE_FAN, offset, vertexCount);
    }
}

function main() {
    const canvas = document.querySelector("#glCanvas");
    const gl = canvas.getContext("webgl");

    if (gl === null) {
        alert("unable to init webgl");
        return;
    }

    const shaderProgram = initShaderProgram(gl, vsSource, fsSource);

    const programInfo = {
        program: shaderProgram,
        attribLocations: {
            vertexPosition: gl.getAttribLocation(shaderProgram, "aVertexPosition"),
        },
        uniformLocations: {
            time: gl.getUniformLocation(shaderProgram, "uTime"),
            frequency: gl.getUniformLocation(shaderProgram, "uFrequency"),
            resolution: gl.getUniformLocation(shaderProgram, "uResolution"),
            gradientSampler: gl.getUniformLocation(shaderProgram, "uGradientSampler"),
            permSampler: gl.getUniformLocation(shaderProgram, "uPermSampler"),
        },
    };

    const buffers = initBuffers(gl);

    document.body.appendChild(document.createElement("br"));

    var xslowButton = document.createElement("button");
    xslowButton.innerHTML = "really slow";
    xslowButton.onclick = function(){frequency = 1/32};
    document.body.appendChild(xslowButton);

    var slowButton = document.createElement("button");
    slowButton.innerHTML = "slow";
    slowButton.onclick = function(){frequency = 1/16};
    document.body.appendChild(slowButton);

    var fastButton = document.createElement("button");
    fastButton.innerHTML = "fast";
    fastButton.onclick = function(){frequency = 1/8};
    document.body.appendChild(fastButton);

    var startTime = Date.now();
    function render(now) {
        drawScene(gl, programInfo, buffers, now * .001);
        requestAnimationFrame(render);
    }
    requestAnimationFrame(render);
}

main();

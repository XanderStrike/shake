
let peerServer = "s://shake-peerserver.standke.dev";

const peerServerWebSocket = `ws${peerServer}`;
const peerServerHTTP = `http${peerServer}`;

// HACK: prevent the browser from queueing too many frames. Defeat pipelineing by calling readPixels() after each frame.
// This synchronizes the content process and the GPU process. We don't want to delay finished frames, so we do this just after
// the browser presents the frame. This is achieved by calling postMessage() in RAF. The message will not be processed
// until the frame is presented.
const originalGetContext = HTMLCanvasElement.prototype.getContext;
let context = null;
HTMLCanvasElement.prototype.getContext = function (type, options) {
    return context = originalGetContext.call(this, type, options);
};
const originalRAF = requestAnimationFrame; // save this now in case someone else tries to hook it later, we don't want to use their hooked version for our noop stuff.
const rafChannel = new MessageChannel();
const nopRAF = () => rafChannel.port1.postMessage(' ');
rafChannel.port2.onmessage = () => {
    if (context) context.readPixels(0, 0, 1, 1, context.RGBA, context.UNSIGNED_BYTE, new Uint8Array(4));
    originalRAF.call(self, nopRAF);
};
originalRAF.call(self, nopRAF);

// Fool Emscripten into rendering in landscape even on portrait displays.
// TODO: vid_restart if the screen resolution changes.
// TODO: We render at CSS pixel resolution, but should we render at device pixel resolution instead? Maybe that would be needlessly high?
const screenPrototype = Object.getPrototypeOf(screen);
const originalScreenWidthProperty = Object.getOwnPropertyDescriptor(screenPrototype, 'width');
const originalScreenHeightProperty = Object.getOwnPropertyDescriptor(screenPrototype, 'height');
if (screen.height > screen.width) {
    Object.defineProperty(screen, 'width', originalScreenHeightProperty);
    Object.defineProperty(screen, 'height', originalScreenWidthProperty);
}

import { GamepadEmulator } from './GamepadEmulator.js';
const emulator = new GamepadEmulator();
const gamepad = emulator.AddEmulatedGamepad(null, true);
const gamepadEmulatorConfig = {
    directions: { up: true, down: true, left: true, right: true },
    dragDistance: 100,
    tapTarget: move,
    xAxisIndex: 0,
    yAxisIndex: 1,
    swapAxes: false,
    invertX: false,
    invertY: false,
};
emulator.AddDisplayJoystickEventListeners(0, [gamepadEmulatorConfig]);

const rotateGamepad = e => {
    gamepadEmulatorConfig.swapAxes = e.matches;
    gamepadEmulatorConfig.invertX = e.matches;
};
const portraitOrientation = window.matchMedia("(orientation: portrait)");
rotateGamepad(portraitOrientation);
portraitOrientation.addEventListener('change', rotateGamepad);


let lastPointerEvent = null;
let fakeMouseDown = false;

look.addEventListener('pointerdown', (e) => {
    lastPointerEvent = e;
    if (e.offsetY < e.target.clientHeight / 2) {
        fakeMouseDown = true;
        const fakeMouseDownEvent = new MouseEvent('mousedown', {
            clientX: e.offsetX / 2,
            clientY: e.offsetY / 2,
            bubbles: true,
            cancelable: true,
            view: window
        });
        canvas.dispatchEvent(fakeMouseDownEvent);
    }
}, { passive: false });

look.addEventListener('pointermove', (e) => {
    if (lastPointerEvent && lastPointerEvent.pointerId === e.pointerId) {
        let deltaX = e.offsetX - lastPointerEvent.offsetX;
        let deltaY = e.offsetY - lastPointerEvent.offsetY;
        const fakeMouseEvent = new MouseEvent('mousemove', {
            clientX: e.offsetX / 2,
            clientY: e.offsetY / 2,
            movementX: deltaX / 2,
            movementY: deltaY / 2,
            bubbles: true,
            cancelable: true,
            view: window
        });
        // Safari doesn't recognize movementX and movementY, so we have to set them manually.
        if (fakeMouseEvent.movementX === undefined) {
            fakeMouseEvent.movementX = deltaX / 2;
            fakeMouseEvent.movementY = deltaY / 2;
        }

        canvas.dispatchEvent(fakeMouseEvent);
        lastPointerEvent = e;
    }
    e.preventDefault();
}, { passive: false });

look.addEventListener('pointerup', (e) => {
    if (lastPointerEvent && lastPointerEvent.pointerId === e.pointerId) {
        lastPointerEvent = null;
        if (fakeMouseDown) {
            fakeMouseDown = false;
            const fakeMouseUpEvent = new MouseEvent('mouseup', {
                clientX: e.offsetX / 2,
                clientY: e.offsetY / 2,
                bubbles: true,
                cancelable: true,
                view: window
            });
            canvas.dispatchEvent(fakeMouseUpEvent);
        }
    }
}, { passive: false });

look.addEventListener('pointercancel', (e) => {
    if (lastPointerEvent && lastPointerEvent.pointerId === e.pointerId) {
        lastPointerEvent = null;
    }
}, { passive: false });

const originalRequestPointerLock = HTMLElement.prototype.requestPointerLock;
HTMLElement.prototype.originalRequestPointerLock = originalRequestPointerLock;

// Block Emscripten from automatically calling requestPointerLock when we don't want it to.
HTMLElement.prototype.requestPointerLock = function (options) {
    console.log('Intercepted requestPointerLock call');
};

// Don't use fullscreen API on iOS because Apple crippled it. Any touch input with a downward drag will exit fullscreen.
const ios = /iPad|iPhone|iPod/.test(navigator.platform) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

let saveFiles = null;
// document.addEventListener('pointerlockchange', ()=>{if (!ios && document.pointerLockElement && !document.fullscreenElement && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen()});
document.addEventListener('fullscreenchange', () => {
    if (saveFiles) saveFiles();
    if (document.fullscreenElement && !document.pointerLockElement && canvas.originalRequestPointerLock) canvas.originalRequestPointerLock({ unadjustedMovement: true });
    ui.style.visibility = document.fullscreenElement ? 'hidden' : 'visible';
});
const fullscreenAndPointerLock = async (e) => {
    if (ui.contains(e.target)) return;
    if (!document.pointerLockElement && canvas.originalRequestPointerLock) canvas.originalRequestPointerLock({ unadjustedMovement: true });
    // if (!ios && !document.fullscreenElement && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
};
blocker.addEventListener('keydown', fullscreenAndPointerLock);
blocker.addEventListener('touchend', fullscreenAndPointerLock);
blocker.addEventListener('mousedown', fullscreenAndPointerLock);
blocker.addEventListener('touchmove', (e) => e.preventDefault()); // required for touchend to fire if the touch moves

// Prevent Safari from showing a magnifying glass on double tap and hold. C'mon Apple...
blocker.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
look.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
move.addEventListener('touchstart', e => e.preventDefault(), { passive: false });


const defaultKeyBindingKeyCodes = {
    "KeyW": true, "KeyA": true, "KeyS": true,
    "KeyD": true, "KeyC": true, "KeyT": true, "Digit1": true, "Digit2": true,
    "Digit3": true, "Digit4": true, "Digit5": true, "Digit6": true, "Digit7": true,
    "Digit8": true, "Digit9": true, "Tab": true, "Space": true, "Enter": true,
    "NumpadEnter": true, "Delete": true, "Slash": true, "Backslash": true,
    "ArrowUp": true, "ArrowDown": true, "ArrowLeft": true, "ArrowRight": true,
    "PageDown": true, "End": true, "Escape": true, "ControlLeft": true,
    "ControlRight": true, "ShiftLeft": true, "ShiftRight": true, "AltLeft": true,
    "AltRight": true
};
window.addEventListener("keydown", (e) => {
    // Emscripten SDL2 will preventDefault all keyboard events which prevents browser keyboard shortcuts from working.
    // This was supposed to be fixed in https://github.com/emscripten-core/emscripten/issues/16462 however the fix regressed.
    // This hack lets the browser handle everything, except for the default Quake III keybindings.
    if (!defaultKeyBindingKeyCodes[e.code]) e.preventDefault = () => false;
}, { capture: true });

let username = localStorage.getItem('username');
let model = localStorage.getItem('model');
if (!username || !model) {
    username = '';
    const chars = ['bcdfghjklmnprstvwz', 'aeiou'];
    for (let i = 0; i < 6; i++)
        username += chars[i % 2].charAt(Math.random() * chars[i % 2].length | 0);
    username = username.charAt(0).toUpperCase() + username.slice(1);
    localStorage.setItem('username', username);
    const models = ['sarge', 'visor', 'major', 'major/daemia', 'major', 'major/daemia', 'grunt', 'grunt/stripe']; // only these are available in the demo, plus red/blue versions but those wouldn't be fair
    model = models[Math.random() * models.length | 0];
    localStorage.setItem('model', model);
}

let generatedArguments = `
    +set fs_game demoq3
`;

let botSkill = 2;

if (window.matchMedia('(pointer: coarse)').matches) {
    generatedArguments += `
        +set cl_autoAttack 1
        +set g_forcerespawn 2
    `;
} else {
    generatedArguments += `
        +set cl_autoAttack 0
    `;
}

const query = new URLSearchParams(window.location.search);
let server = query.get('server');
if (!query.has('lonely')) {
    if (!server) server = "default";
    let newUrl = new URL(window.location);
    if (server !== "default") {
        newUrl.searchParams.set('server', server);
        history.replaceState(null, '', newUrl);
    }
}

let map = query.get('map');
if (!map) {
    map = "q3dm17";
}

let multiplayer = !!server;

let decideConnectToServer;
let connectToServer = new Promise(r => decideConnectToServer = r);
if (server) {
    // sanitize to hopefully avoid command injection in autoexec.cfg
    server = server.replace(/"/g, '');
    fetch(`${peerServerHTTP}/lookup/${server}`).then(r => r.json()).then((r) => decideConnectToServer(r.found)).catch(() => { decideConnectToServer(false); });
}

let buildPath = '.';
if (location.pathname.startsWith('/ioq3/code/web/')) {
    buildPath = '../../build/debug-emscripten-wasm32';
}
function fetchAndCacheFile(filePath, cacheName, promiseResolver) {
    return async function() {
        const cache = await caches.open(cacheName);
        let response = await cache.match(filePath);
        if (!response) {
            const uiElement = document.getElementById('ui');
            const progressDiv = document.createElement('div');
            progressDiv.id = `progress-${filePath}`;
            uiElement.appendChild(progressDiv);

            response = await fetch(filePath);
            const reader = response.body.getReader();
            const contentLength = +response.headers.get('Content-Length');
            let receivedLength = 0;
            let chunks = [];
            
            while(true) {
                const {done, value} = await reader.read();
                if (done) break;
                chunks.push(value);
                receivedLength += value.length;
                const percentage = Math.round((receivedLength / contentLength) * 100);
                progressDiv.textContent = `${filePath} ${percentage}%`;
            }
            
            progressDiv.style.display = 'none';
            const blob = new Blob(chunks);
            response = new Response(blob);
            cache.put(filePath, response.clone());
        }
        const arrayBuffer = await response.arrayBuffer();
        promiseResolver(new Uint8Array(arrayBuffer));
    };
}

let gotZtmFlexibleHud;
const ztmFlexibleHud = new Promise(r => gotZtmFlexibleHud = r);
fetchAndCacheFile(`${buildPath}/ztm-flexible-hud.pk3`, 'ztm-cache', gotZtmFlexibleHud)();

let gotDemoq3Pak = [];
const demoq3PakPromises = [];
for (let i = 0; i <= 8; i++) {
    demoq3PakPromises[i] = new Promise(r => gotDemoq3Pak[i] = r);
    fetchAndCacheFile(`${buildPath}/demoq3/pak${i}.pk3`, 'demoq3-cache', gotDemoq3Pak[i])();
}

var customMap;
if (map) {
    let gotcustomMap;
    customMap = new Promise(r => gotcustomMap = r);
    fetchAndCacheFile(`${buildPath}/demoq3/${map}.pk3`, 'demoq3-cache', gotcustomMap)();
}

// Fool Emscripten into thinking the browser supports pointer lock.
if (!document.body.requestPointerLock) document.body.requestPointerLock = () => true;

let firstMainLoop = true;
let shadersCompiled = 0;
let shadersTotal = 57;
let module = null;
import(`${buildPath}/ioquake3_opengl2.wasm32.js`).then(async (ioquake3) => {
    module = await ioquake3.default({
        canvas: canvas,
        arguments: generatedArguments.trim().split(/\s+/),
        locateFile: (file) => `${buildPath}/${file}`,
        postMainLoop: () => {
            if (firstMainLoop) {
                firstMainLoop = false;
                // SDL is initialized now that the main loop has run for the first time.
                if (window.matchMedia('(pointer: coarse)').matches) {
                    // Need to fool Emscripten into believing that pointer lock is enabled so we can send it fake pointer events.
                    Object.defineProperty(document, 'pointerLockElement', { get: () => canvas });

                    const fakePointerLockChangeEvent = new Event('pointerlockchange', {
                        bubbles: true,
                        cancelable: true
                    });
                    document.dispatchEvent(fakePointerLockChangeEvent);
                }
            }
        },
        printErr: (msg) => {
            console.error(msg);
        },
        preRun: [async (module) => {
            document.addEventListener('visibilitychange', () => {
                // Silence audio when the tab is hidden.
                if (document.hidden) {
                    for (const c of Object.values(module.AL.contexts)) {
                        c.gain.gain.linearRampToValueAtTime(0, c.audioCtx.currentTime + 0.1);
                    }
                } else {
                    for (const c of Object.values(module.AL.contexts)) {
                        c.gain.gain.setValueAtTime(0.00001, c.audioCtx.currentTime);
                        c.gain.gain.exponentialRampToValueAtTime(1, c.audioCtx.currentTime + 1);
                    }
                }
            });
            // Add the fetched asset files to the Emscripten virtual filesystem.
            module.addRunDependency('setup-ioq3-filesystem');
            module.FS.mkdirTree('/home/web_user/.q3a');
            module.FS.mount(module.FS.filesystems.IDBFS, {}, '/home/web_user/.q3a');
            let idbfsReadyResolve = null;
            const idbfsReady = new Promise(r => idbfsReadyResolve = r);
            module.FS.syncfs(true, (err) => {
                if (err) { console.error(err); debugger; }
                idbfsReadyResolve();
            });
            await idbfsReady;
            try {
                if (!module.FS.analyzePath('/home/web_user/.q3a/demoq3/q3config.cfg').exists) {
                    module.arguments.push(...`
                        +set model "${model}"
                        +set headmodel "${model}"
                        +set name "${username}"
                        `.trim().split(/\s+/));
                } else {
                    // Read the existing q3config.cfg and update the name and model in case the user changed them.
                    const q3config = module.FS.readFile('/home/web_user/.q3a/demoq3/q3config.cfg', { encoding: 'utf8' });
                    const lines = q3config.split('\n');
                    for (let i = 0; i < lines.length; i++) {
                        if (lines[i].startsWith('seta name')) {
                            localStorage.setItem('username', lines[i].split('"')[1]);
                        } else if (lines[i].startsWith('seta model') || lines[i].startsWith('seta headmodel')) {
                            localStorage.setItem('model', lines[i].split('"')[1]);
                        }
                    }
                }
            } catch (err) {
                console.error('Error reading q3config.cfg:', err);
            }
            saveFiles = () => {
                module.FS.syncfs(false, (err) => {
                    if (err) { console.error(err); debugger; }
                });
            };
            saveFiles();
            module.FS.mkdirTree('/demoq3');
            for (let i = 0; i <= 8; i++) {
                module.FS.writeFile(`/demoq3/pak${i}.pk3`, await demoq3PakPromises[i]);
            }
            module.FS.writeFile('/demoq3/ztm-flexible-hud.pk3', await ztmFlexibleHud);
            if (map) {
                module.FS.writeFile(`/demoq3/${map}.pk3`, await customMap);
            }
            if (multiplayer) {
                if (await connectToServer) {
                    module.arguments.push(...`
                        +set net_peer_server "${peerServerWebSocket}"
                        +connect "${server}.humblenet"
                    `.trim().split(/\s+/));
                } else {
                    module.arguments.push(...`
                        +set net_peer_server "${peerServerWebSocket}"
                        +set net_server_name "${server}"
                        +map ${map}
                        `.trim().split(/\s+/));
                }
            } else {
                module.arguments.push(...`
                    +map ${map}
                    +addbot sarge ${botSkill}
                    +addbot daemia ${botSkill}
                    +addbot major ${botSkill}
                    +addbot visor ${botSkill}
                    +addbot stripe ${botSkill}
                `.trim().split(/\s+/));
            }
            module.FS.writeFile('/demoq3/autoexec.cfg', `
                set in_joystick 1
                set in_joystickUseAnalog 1
                set j_forward "0.005"
                set j_side "0.005"
                set j_pitch "0.005"
                set j_yaw "0.01"
                bind PAD0_LEFTSTICK_LEFT "+moveleft"
                bind PAD0_LEFTSTICK_RIGHT "+moveright"
                bind PAD0_LEFTSTICK_UP "+forward"
                bind PAD0_LEFTSTICK_DOWN "+back"
                bind PAD0_DPAD_LEFT "+moveleft"
                bind PAD0_DPAD_UP "+forward"
                bind PAD0_DPAD_RIGHT "+moveright"
                bind PAD0_DPAD_DOWN "+back"
                bind PAD0_RIGHTSTICK_LEFT "+left"
                bind PAD0_RIGHTSTICK_RIGHT "+right"
                bind PAD0_RIGHTSTICK_UP "+lookup"
                bind PAD0_RIGHTSTICK_DOWN "+lookdown"
                bind PAD0_RIGHTTRIGGER "+attack"
                bind PAD0_LEFTTRIGGER "+zoom"
                bind PAD0_A "+moveup"
                bind PAD0_B "weapnext"
                bind PAD0_X "weapprev"
                bind PAD0_Y "weapon 1"
                bind PAD0_LEFTSHOULDER "+zoom"
                bind PAD0_RIGHTSHOULDER "+attack"
                bind PAD0_START "togglemenu"
                bind PAD0_BACK "+button3"
                bind PAD0_LEFTSTICK_CLICK "+zoom"
                bind PAD0_RIGHTSTICK_CLICK "+button3"

                set r_mode -2 // make game use desktop resolution
                set r_picmip 0 // full texture detail
                set r_lodBias -2 // don't use lower detail models far away
                set r_subdivisions 1 // smoother curves
                set r_textureMode "GL_LINEAR_MIPMAP_LINEAR" // trilinear filter
                set r_ext_texture_filter_anisotropic 1 // enable anisotropy texture filter
                set r_ext_max_anisotropy 16 // 16x anisotropy texture filter
                set r_ext_multisample 16 // use multisample antialiasing
                set r_ext_framebuffer_multisample 16 // use multisample antialiasing
                set r_lodCurveError 10000 // smoother curves far away (cheat protected)

                set r_mode -2
                set cg_fovGunAdjust 1
                set cg_fovAspectAdjust 1
                set com_maxfps 0
                set r_swapInverval 1
                set net_enabled 1
                set r_fullscreen 0
                set r_ignoreGLErrors 1
                set cg_fov 90
                set cg_deferPlayers 0 // load player models when they connect instead of substituting a random model

                set sv_fps 60
                set sv_maxclients 128
                set snaps 60
                set cl_maxpackets 125
                set sv_pure 1

                    `, { encoding: 'utf8' });
            module.removeRunDependency('setup-ioq3-filesystem');
        }],
    });
    if (multiplayer) {
        // Always run server even in background tabs.
        // Workers are not subject to setTimeout/setInterval throttling in background tabs and they can postMessage to wake the main thread.
        // This will render too which is unfortunate but whatever.
        // Probably doesn't work on mobile. I guess it's fine.
        const worker = new Worker(URL.createObjectURL(new Blob([`
            setInterval(() => {
                self.postMessage('tick');
            }, 1000 / 60);
        `], { type: 'application/javascript' })));
        worker.onmessage = function (e) {
            if (document.hidden && module && module.Browser && module.Browser.mainLoop)
                module.Browser.mainLoop.runIter(module.Browser.mainLoop.func);
        };
    }
});

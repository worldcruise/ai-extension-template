(() => {
    'use strict';

    const INSTALL_FLAG = '__sideAiMicDetectorInstalled';
    if (window[INSTALL_FLAG]) return;

    Object.defineProperty(window, INSTALL_FLAG, {
        value: true,
        configurable: false
    });

    const MIC_REQUEST_MESSAGE = 'SIDEAI_CHATGPT_MIC_REQUEST';
    const MIC_ENABLE_MESSAGE = 'SIDEAI_ENABLE_MIC_DETECTOR';
    const MIC_PERMISSION_GRANTED_MESSAGE = 'SIDEAI_EXTENSION_MIC_PERMISSION_GRANTED';
    const MIC_PERMISSION_DENIED_MESSAGE = 'SIDEAI_EXTENSION_MIC_PERMISSION_DENIED';
    const WAIT_TIMEOUT_MS = 45000;

    let requestSequence = 0;
    let detectorEnabled = false;

    function isFramed() {
        try {
            return window.self !== window.top;
        } catch (error) {
            return true;
        }
    }

    function hasExtensionSidepanelReferrer() {
        return /^chrome-extension:\/\/[^/]+\/sidepanel\/index\.html/i.test(document.referrer || '');
    }

    function hasAudioConstraint(constraints) {
        if (!constraints || typeof constraints !== 'object') return false;
        if (!Object.prototype.hasOwnProperty.call(constraints, 'audio')) return false;
        return constraints.audio !== false && constraints.audio !== null && constraints.audio !== undefined;
    }

    function summarizeConstraints(constraints) {
        if (!constraints || typeof constraints !== 'object') {
            return { audio: false, video: false };
        }

        return {
            audio: hasAudioConstraint(constraints),
            video: Boolean(constraints.video)
        };
    }

    function createRequestId(apiName) {
        requestSequence += 1;
        return `sideai-mic-${Date.now()}-${requestSequence}-${apiName}`;
    }

    function postMicRequest(apiName, constraints, requestId) {
        window.postMessage({
            type: MIC_REQUEST_MESSAGE,
            source: 'sideai-mic-detector',
            requestId,
            apiName,
            constraints: summarizeConstraints(constraints),
            frame: window === window.top ? 'top' : 'iframe',
            href: window.location.href
        }, '*');
    }

    function createPermissionDeniedError(message) {
        try {
            return new DOMException(message, 'NotAllowedError');
        } catch (error) {
            const fallback = new Error(message);
            fallback.name = 'NotAllowedError';
            return fallback;
        }
    }

    function resultMatchesRequest(data, requestId) {
        if (!data) return false;
        const requestIds = Array.isArray(data.requestIds)
            ? data.requestIds
            : (data.requestId ? [data.requestId] : []);

        return requestIds.length === 0 || requestIds.includes(requestId);
    }

    function waitForExtensionPermission(requestId) {
        return new Promise((resolve, reject) => {
            const timeoutId = window.setTimeout(() => {
                cleanup();
                resolve({ status: 'timeout' });
            }, WAIT_TIMEOUT_MS);

            function cleanup() {
                window.clearTimeout(timeoutId);
                window.removeEventListener('message', handlePermissionResult, true);
            }

            function handlePermissionResult(event) {
                if (event.source !== window) return;

                const data = event.data;
                if (!data || !resultMatchesRequest(data, requestId)) return;

                if (data.type === MIC_PERMISSION_GRANTED_MESSAGE) {
                    cleanup();
                    resolve({ status: 'granted' });
                    return;
                }

                if (data.type === MIC_PERMISSION_DENIED_MESSAGE) {
                    cleanup();
                    reject(createPermissionDeniedError(data.error || 'Microphone permission was denied.'));
                }
            }

            window.addEventListener('message', handlePermissionResult, true);
        });
    }

    function wrapMediaDevicesGetUserMedia() {
        const mediaDevices = navigator.mediaDevices;
        if (!mediaDevices || typeof mediaDevices.getUserMedia !== 'function') return false;
        if (mediaDevices.getUserMedia.__sideAiWrapped) return true;

        const originalGetUserMedia = mediaDevices.getUserMedia.bind(mediaDevices);

        const wrappedGetUserMedia = function sideAiGetUserMediaWrapper(constraints) {
            if (!hasAudioConstraint(constraints)) {
                return originalGetUserMedia(constraints);
            }

            const requestId = createRequestId('getUserMedia');
            postMicRequest('getUserMedia', constraints, requestId);

            return waitForExtensionPermission(requestId)
                .then(() => originalGetUserMedia(constraints));
        };

        Object.defineProperty(wrappedGetUserMedia, '__sideAiWrapped', {
            value: true,
            configurable: false
        });

        try {
            Object.defineProperty(mediaDevices, 'getUserMedia', {
                value: wrappedGetUserMedia,
                configurable: true,
                writable: true
            });
        } catch (error) {
            mediaDevices.getUserMedia = wrappedGetUserMedia;
        }

        return true;
    }

    function wrapLegacyGetUserMedia(apiName) {
        const original = navigator[apiName];
        if (typeof original !== 'function' || original.__sideAiWrapped) return;

        const wrapped = function sideAiLegacyGetUserMediaWrapper(constraints, onSuccess, onError) {
            if (!hasAudioConstraint(constraints)) {
                return original.call(navigator, constraints, onSuccess, onError);
            }

            const requestId = createRequestId(apiName);
            postMicRequest(apiName, constraints, requestId);

            waitForExtensionPermission(requestId)
                .then(() => original.call(navigator, constraints, onSuccess, onError))
                .catch((error) => {
                    if (typeof onError === 'function') onError(error);
                });
        };

        Object.defineProperty(wrapped, '__sideAiWrapped', {
            value: true,
            configurable: false
        });

        try {
            Object.defineProperty(navigator, apiName, {
                value: wrapped,
                configurable: true,
                writable: true
            });
        } catch (error) {
            navigator[apiName] = wrapped;
        }
    }

    function installDetector() {
        if (!isFramed()) return false;

        const installed = wrapMediaDevicesGetUserMedia();
        wrapLegacyGetUserMedia('getUserMedia');
        wrapLegacyGetUserMedia('webkitGetUserMedia');
        wrapLegacyGetUserMedia('mozGetUserMedia');
        return installed;
    }

    function enableDetector() {
        if (detectorEnabled) return;
        detectorEnabled = true;

        if (!installDetector()) {
            window.setTimeout(installDetector, 250);
            window.addEventListener('DOMContentLoaded', installDetector, { once: true });
        }
    }

    window.addEventListener('message', (event) => {
        const data = event.data;
        if (!data || data.type !== MIC_ENABLE_MESSAGE || data.source !== 'sideai-sidepanel') return;
        if (!isFramed()) return;
        enableDetector();
    }, true);

    if (hasExtensionSidepanelReferrer()) {
        enableDetector();
    }
})();

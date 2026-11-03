/** One owned narration at a time: bundled audio first, system speech once on failure. */ // NEW
(function (root) { // NEW
    'use strict'; // NEW
    const script = root.document.currentScript?.src; // NEW
    const base = root.TrellisNarrationAssetBase || new root.URL(script ? '../audio/narration/' : 'audio/narration/', script || root.document.baseURI).href; // NEW
    let active = null; // NEW
    /** Invalidate ownership before canceling native playback, whose callbacks can run synchronously. */ // NEW
    function stop(owner) { // NEW
        if (!active || active.owner !== owner) return; // NEW
        const previous = active; active = null; release(previous); // NEW
    } // NEW
    /** Remove listeners before releasing resources; cancellation is never a playback failure. */ // NEW
    function release(session) { // NEW
        root.clearTimeout(session.timer); session.observer?.disconnect(); // NEW
        clearAudio(session); // NEW
        if (session.utterance) { // NEW
            session.utterance.onend = session.utterance.onerror = null; // NEW
            try { root.speechSynthesis?.cancel(); } catch (_) { /* Written guidance remains available. */ } // NEW
            session.utterance = null; // NEW
        } // NEW
    } // NEW
    function clearAudio(session) { // NEW
        if (!session.audio) return; // NEW
        const audio = session.audio; session.audio = null; // NEW
        audio.onended = audio.onerror = audio.onplaying = audio.ontimeupdate = null; // NEW
        try { audio.pause(); audio.removeAttribute('src'); audio.load(); } catch (_) { /* Already released or unavailable. */ } // NEW
    } // NEW
    /** DOM owners that were connected at playback start cannot outlive their screen. */ // NEW
    function current(session) { // NEW
        if (active !== session) return false; // NEW
        if (session.connected && !session.owner.isConnected) { stop(session.owner); return false; } // NEW
        return true; // NEW
    } // NEW
    function finish(session, error) { // NEW
        if (!current(session)) return; // NEW
        active = null; release(session); // NEW
        if (error) session.onError?.(error); else session.onEnd?.(); // NEW
    } // NEW
    /** Lack of progress, rather than total clip duration, bounds loading and stalled playback. */ // NEW
    function guard(session, milliseconds, callback) { // NEW
        root.clearTimeout(session.timer); // NEW
        session.timer = root.setTimeout(() => { if (current(session)) callback(); }, milliseconds); // NEW
    } // NEW
    function fallback(session) { // NEW
        if (!current(session) || session.mode === 'speech') return; // NEW
        session.mode = 'speech'; root.clearTimeout(session.timer); clearAudio(session); // NEW
        try { // NEW
            if (!root.speechSynthesis || !root.SpeechSynthesisUtterance) throw new Error('Speech unavailable'); // NEW
            const speech = new root.SpeechSynthesisUtterance(session.text); session.utterance = speech; speech.lang = 'en-US'; // NEW
            const voices = root.speechSynthesis.getVoices?.() || []; // NEW
            const local = voices.find(voice => voice.localService && /^en-US$/i.test(voice.lang)) || voices.find(voice => voice.localService && /^en\b/i.test(voice.lang)); // NEW
            if (local) speech.voice = local; // NEW
            speech.onend = () => finish(session); // NEW
            speech.onerror = event => finish(session, new Error(event?.error || 'System speech failed')); // NEW
            guard(session, Math.max(12000, session.text.length * 90), () => finish(session, new Error('System speech did not complete'))); // NEW
            root.speechSynthesis.speak(speech); // NEW
        } catch (error) { finish(session, error); } // NEW
    } // NEW
    /** Callers supply the same exact text they display; the manifest matches it directly. */ // NEW
    function play({ owner, text, onEnd, onError }) { // NEW
        if (active) stop(active.owner); // NEW
        const session = { owner, text, onEnd, onError, mode: 'clip', connected: !!owner?.isConnected, lastTime: 0 }; active = session; // NEW
        if (session.connected && root.MutationObserver) { // NEW
            session.observer = new root.MutationObserver(() => current(session)); // NEW
            session.observer.observe(root.document, { childList: true, subtree: true }); // NEW
        } // NEW
        const clip = root.TrellisNarrationRecordings?.clips?.find(item => item.text === text); // NEW
        if (!clip || !/^clip-\d+\.mp3$/.test(clip.file) || !root.Audio) { fallback(session); return; } // NEW
        try { // NEW
            const audio = new root.Audio(new root.URL(clip.file, base).href); session.audio = audio; // NEW
            audio.preload = 'auto'; // NEW
            const failed = () => { if (current(session) && session.mode === 'clip') fallback(session); }; // NEW
            audio.onerror = failed; // NEW
            audio.onended = () => { if (session.mode === 'clip') finish(session); }; // NEW
            audio.onplaying = () => { if (current(session) && session.mode === 'clip') guard(session, 10000, failed); }; // NEW
            audio.ontimeupdate = () => { // NEW
                if (current(session) && session.mode === 'clip' && audio.currentTime > session.lastTime) { session.lastTime = audio.currentTime; guard(session, 10000, failed); } // NEW
            }; // NEW
            guard(session, 10000, failed); // NEW
            const pending = audio.play(); // NEW
            pending?.catch(failed); // NEW
        } catch (_) { fallback(session); } // NEW
    } // NEW
    root.TrellisNarration = Object.freeze({ play, stop }); // NEW
    root.addEventListener('beforeunload', () => { if (active) stop(active.owner); }); // NEW
})(window); // NEW

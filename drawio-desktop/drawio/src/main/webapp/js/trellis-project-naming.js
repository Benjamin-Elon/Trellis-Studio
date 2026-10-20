/** Shared, deterministic display-name and portable-filename rules. */ // NEW
(function(root) { // NEW
    'use strict'; // NEW
    const PROJECT_NAME_ATTR = 'trellis_project_name'; // NEW
    function text(value, limit, required) { // NEW
        if (typeof value !== 'string') throw new Error('Enter a valid name.'); // NEW
        if (required && !value.trim()) throw new Error('Enter a project name.'); // CHANGE
        if (Array.from(value).length > limit) throw new Error('Use at most ' + limit + ' characters.'); // CHANGE
        return value; // CHANGE: display text is preserved; only filenames undergo conversion.
    } // NEW
    function displayName(name, suffix = '') { return name + (suffix ? ' - ' + suffix : ''); } // NEW
    /** Reserve basename space for draw.io's draft prefixes/counters; never split a Unicode code point. */ // CHANGE
    function filename(name, suffix = '') { // NEW
        let stem = displayName(name, suffix).replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '-').replace(/[. ]+$/g, '').trim() || 'Garden'; // NEW
        if (/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(stem)) stem = '_' + stem; // NEW
        const encoder = new TextEncoder(); let result = '', bytes = 0; // NEW
        for (const character of stem) { const length = encoder.encode(character).length; if (bytes + length > 220) break; result += character; bytes += length; } // CHANGE
        return (result.replace(/[. ]+$/g, '') || 'Garden') + '.drawio'; // NEW
    } // NEW
    root.TrellisProjectNaming = Object.freeze({ PROJECT_NAME_ATTR, projectName: value => text(value, 120, true), suffix: value => text(value, 80, false), displayName, filename }); // NEW
})(globalThis); // NEW

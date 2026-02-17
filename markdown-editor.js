/**
 * Markdown Blog Editor — IdefixTools
 * Full-featured markdown editor with live preview, image management, and export.
 */

(function () {
    'use strict';

    // ========================================
    //  State
    // ========================================

    const state = {
        images: [],          // { id, name, dataUrl, file, mimeType }
        selectedGalleryId: null,
        lastSavedContent: '',
    };

    // ========================================
    //  DOM refs
    // ========================================

    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    const markdownInput    = $('#markdownInput');
    const markdownPreview  = $('#markdownPreview');
    const charCount        = $('#charCount');
    const filenameInput    = $('#filenameInput');
    const exportMdBtn      = $('#exportMdBtn');
    const exportAllBtn     = $('#exportAllBtn');
    const copyHtmlBtn      = $('#copyHtmlBtn');
    const imageUploadInput = $('#imageUpload');
    const imageGallery     = $('#imageGallery');

    // Modals
    const imageModal       = $('#imageModal');
    const linkModal        = $('#linkModal');
    const tableModal       = $('#tableModal');

    // ========================================
    //  Dark mode (re-use from main site)
    // ========================================

    const darkModeToggle = $('#darkModeToggle');
    const darkModePref   = localStorage.getItem('darkMode');

    if (darkModePref === 'disabled') {
        document.body.classList.remove('dark-mode');
    }
    updateDarkModeIcon();

    darkModeToggle.addEventListener('click', function () {
        document.body.classList.toggle('dark-mode');
        localStorage.setItem('darkMode', document.body.classList.contains('dark-mode') ? 'enabled' : 'disabled');
        updateDarkModeIcon();
    });

    function updateDarkModeIcon() {
        const icon = darkModeToggle.querySelector('i');
        if (document.body.classList.contains('dark-mode')) {
            icon.classList.remove('fa-moon');
            icon.classList.add('fa-sun');
        } else {
            icon.classList.remove('fa-sun');
            icon.classList.add('fa-moon');
        }
    }

    // ========================================
    //  Simple Markdown → HTML parser
    // ========================================

    function parseMarkdown(md) {
        let html = md;

        // Normalize line endings
        html = html.replace(/\r\n/g, '\n');

        // Fenced code blocks ``` ... ```
        html = html.replace(/```(\w*)\n([\s\S]*?)```/g, function (_, lang, code) {
            const escaped = escapeHtml(code.trimEnd());
            return '<pre><code class="language-' + (lang || 'text') + '">' + escaped + '</code></pre>';
        });

        // Table of contents placeholder
        html = html.replace(/^\[TOC\]$/gm, '{{TOC_PLACEHOLDER}}');

        // Tables
        html = html.replace(/^(\|.+\|)\n(\|[\s:-]+\|)\n((?:\|.+\|\n?)*)/gm, function (_, headerRow, sepRow, bodyRows) {
            let table = '<table><thead><tr>';
            const headers = headerRow.split('|').filter(c => c.trim() !== '');
            headers.forEach(h => { table += '<th>' + h.trim() + '</th>'; });
            table += '</tr></thead><tbody>';
            const rows = bodyRows.trim().split('\n');
            rows.forEach(function (row) {
                table += '<tr>';
                const cells = row.split('|').filter(c => c.trim() !== '');
                cells.forEach(c => { table += '<td>' + c.trim() + '</td>'; });
                table += '</tr>';
            });
            table += '</tbody></table>';
            return table;
        });

        // Horizontal rule
        html = html.replace(/^---+$/gm, '<hr>');

        // Headers
        html = html.replace(/^#### (.+)$/gm, '<h4 id="$1">$1</h4>');
        html = html.replace(/^### (.+)$/gm, '<h3 id="$1">$1</h3>');
        html = html.replace(/^## (.+)$/gm, '<h2 id="$1">$1</h2>');
        html = html.replace(/^# (.+)$/gm, '<h1 id="$1">$1</h1>');

        // Blockquote
        html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');

        // Checklist items
        html = html.replace(/^- \[x\] (.+)$/gm, '<li class="task-item"><input type="checkbox" checked disabled> $1</li>');
        html = html.replace(/^- \[ \] (.+)$/gm, '<li class="task-item"><input type="checkbox" disabled> $1</li>');

        // Unordered list items
        html = html.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');

        // Ordered list items
        html = html.replace(/^\d+\. (.+)$/gm, '<oli>$1</oli>');

        // Wrap consecutive <li> in <ul>, <oli> in <ol>
        html = html.replace(/((?:<li class="task-item">.*<\/li>\n?)+)/g, '<ul class="task-list">$1</ul>');
        html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');
        html = html.replace(/((?:<oli>.*<\/oli>\n?)+)/g, function (match) {
            return '<ol>' + match.replace(/<\/?oli>/g, function (tag) {
                return tag.replace('oli', 'li');
            }) + '</ol>';
        });

        // Merge adjacent blockquotes
        html = html.replace(/<\/blockquote>\n<blockquote>/g, '<br>');

        // Images — support both ![alt](src) and ![alt](dataurl)
        html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)(\{header\})?/g, function (_, alt, src, isHeader) {
            // Check if src refers to an image in state
            const stateImg = state.images.find(i => i.name === src || i.id === src);
            const actualSrc = stateImg ? stateImg.dataUrl : src;
            const cls = isHeader ? ' class="header-image"' : '';
            return '<img src="' + actualSrc + '" alt="' + alt + '"' + cls + '>';
        });

        // Links
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

        // Inline code (must come before bold/italic)
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

        // Bold
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');

        // Italic
        html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
        html = html.replace(/_(.+?)_/g, '<em>$1</em>');

        // Strikethrough
        html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');

        // Paragraphs — wrap orphan lines
        html = html.replace(/^(?!<[a-z/])(.*\S.*)$/gm, '<p>$1</p>');

        // Clean up empty paragraphs wrapping block elements
        html = html.replace(/<p>(<(?:h[1-4]|ul|ol|li|blockquote|table|pre|hr|img)[^>]*>)/g, '$1');
        html = html.replace(/(<\/(?:h[1-4]|ul|ol|li|blockquote|table|pre|hr)>)<\/p>/g, '$1');

        // Build Table of Contents
        if (html.includes('{{TOC_PLACEHOLDER}}')) {
            const tocHtml = buildToc(md);
            html = html.replace(/<p>{{TOC_PLACEHOLDER}}<\/p>|{{TOC_PLACEHOLDER}}/g, tocHtml);
        }

        // Sanitize heading IDs
        html = html.replace(/<(h[1-4]) id="([^"]+)">/g, function (_, tag, text) {
            const slug = slugify(text);
            return '<' + tag + ' id="' + slug + '">';
        });

        return html;
    }

    function escapeHtml(text) {
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
        return text.replace(/[&<>"']/g, function (m) { return map[m]; });
    }

    function slugify(text) {
        return text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').trim();
    }

    function buildToc(md) {
        const headingRegex = /^(#{2,4}) (.+)$/gm;
        let match;
        const items = [];

        while ((match = headingRegex.exec(md)) !== null) {
            const level = match[1].length; // 2, 3, or 4
            const text = match[2];
            items.push({ level: level, text: text, slug: slugify(text) });
        }

        if (items.length === 0) return '<p><em>No headings found for Table of Contents.</em></p>';

        let toc = '<div class="toc"><div class="toc-title">📑 Table of Contents</div><ul>';
        items.forEach(function (item) {
            toc += '<li class="toc-h' + item.level + '"><a href="#' + item.slug + '">' + item.text + '</a></li>';
        });
        toc += '</ul></div>';
        return toc;
    }

    // ========================================
    //  Live Preview
    // ========================================

    function updatePreview() {
        const md = markdownInput.value;
        if (md.trim() === '') {
            markdownPreview.innerHTML = '<p class="preview-placeholder">Your rendered blog post will appear here...</p>';
        } else {
            markdownPreview.innerHTML = parseMarkdown(md);
        }
        charCount.textContent = md.length + ' chars';
    }

    let previewTimeout;
    markdownInput.addEventListener('input', function () {
        clearTimeout(previewTimeout);
        previewTimeout = setTimeout(updatePreview, 150);
    });

    // ========================================
    //  Toolbar actions
    // ========================================

    function insertAtCursor(before, after, defaultText) {
        const start = markdownInput.selectionStart;
        const end = markdownInput.selectionEnd;
        const selected = markdownInput.value.substring(start, end) || defaultText || '';
        const text = before + selected + (after || '');
        markdownInput.setRangeText(text, start, end, 'select');
        markdownInput.focus();
        // Set cursor after inserted text
        const newPos = start + before.length + selected.length + (after ? after.length : 0);
        markdownInput.setSelectionRange(start + before.length, start + before.length + selected.length);
        updatePreview();
    }

    function insertAtLineStart(prefix) {
        const start = markdownInput.selectionStart;
        const val = markdownInput.value;
        // Find start of current line
        const lineStart = val.lastIndexOf('\n', start - 1) + 1;
        markdownInput.setRangeText(prefix, lineStart, lineStart, 'end');
        markdownInput.focus();
        updatePreview();
    }

    function insertBlock(text) {
        const start = markdownInput.selectionStart;
        const val = markdownInput.value;
        // Ensure we're on a new line
        const before = start > 0 && val[start - 1] !== '\n' ? '\n' : '';
        const after = start < val.length && val[start] !== '\n' ? '\n' : '';
        markdownInput.setRangeText(before + text + after, start, start, 'end');
        markdownInput.focus();
        updatePreview();
    }

    // Handle toolbar button clicks
    document.querySelectorAll('.toolbar-btn[data-action]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            const action = this.dataset.action;
            switch (action) {
                case 'h1': insertAtLineStart('# '); break;
                case 'h2': insertAtLineStart('## '); break;
                case 'h3': insertAtLineStart('### '); break;
                case 'h4': insertAtLineStart('#### '); break;
                case 'bold': insertAtCursor('**', '**', 'bold text'); break;
                case 'italic': insertAtCursor('*', '*', 'italic text'); break;
                case 'strikethrough': insertAtCursor('~~', '~~', 'strikethrough'); break;
                case 'code': insertAtCursor('`', '`', 'code'); break;
                case 'ul': insertAtLineStart('- '); break;
                case 'ol': insertAtLineStart('1. '); break;
                case 'checklist': insertAtLineStart('- [ ] '); break;
                case 'blockquote': insertAtLineStart('> '); break;
                case 'link': openLinkModal(); break;
                case 'image': openImageModal(); break;
                case 'table': openTableModal(); break;
                case 'codeblock': insertBlock('```\ncode here\n```'); break;
                case 'hr': insertBlock('---'); break;
                case 'toc': insertBlock('[TOC]'); break;
            }
        });
    });

    // Keyboard shortcuts
    markdownInput.addEventListener('keydown', function (e) {
        if (e.ctrlKey || e.metaKey) {
            if (e.key === 'b') { e.preventDefault(); insertAtCursor('**', '**', 'bold text'); }
            if (e.key === 'i') { e.preventDefault(); insertAtCursor('*', '*', 'italic text'); }
            if (e.key === 'k') { e.preventDefault(); openLinkModal(); }
        }
        // Tab for indent
        if (e.key === 'Tab') {
            e.preventDefault();
            insertAtCursor('    ', '', '');
        }
    });

    // ========================================
    //  Link Modal
    // ========================================

    function openLinkModal() {
        const selected = markdownInput.value.substring(markdownInput.selectionStart, markdownInput.selectionEnd);
        $('#linkTextInput').value = selected || '';
        $('#linkUrlInput').value = '';
        linkModal.style.display = 'flex';
        (selected ? $('#linkUrlInput') : $('#linkTextInput')).focus();
    }

    $('#linkModalClose').addEventListener('click', function () { linkModal.style.display = 'none'; });
    $('#linkModalCancel').addEventListener('click', function () { linkModal.style.display = 'none'; });
    linkModal.addEventListener('click', function (e) { if (e.target === linkModal) linkModal.style.display = 'none'; });

    $('#linkModalInsert').addEventListener('click', function () {
        const text = $('#linkTextInput').value || 'link';
        const url = $('#linkUrlInput').value || 'https://';
        insertAtCursor('[' + text + '](' + url + ')', '', '');
        linkModal.style.display = 'none';
    });

    // ========================================
    //  Table Modal
    // ========================================

    function openTableModal() {
        $('#tableColsInput').value = 3;
        $('#tableRowsInput').value = 3;
        tableModal.style.display = 'flex';
        $('#tableColsInput').focus();
    }

    $('#tableModalClose').addEventListener('click', function () { tableModal.style.display = 'none'; });
    $('#tableModalCancel').addEventListener('click', function () { tableModal.style.display = 'none'; });
    tableModal.addEventListener('click', function (e) { if (e.target === tableModal) tableModal.style.display = 'none'; });

    $('#tableModalInsert').addEventListener('click', function () {
        const cols = parseInt($('#tableColsInput').value) || 3;
        const rows = parseInt($('#tableRowsInput').value) || 3;
        let md = '\n';
        // Header
        md += '| ' + Array.from({ length: cols }, function (_, i) { return 'Header ' + (i + 1); }).join(' | ') + ' |\n';
        // Separator
        md += '| ' + Array.from({ length: cols }, function () { return '---'; }).join(' | ') + ' |\n';
        // Rows
        for (let r = 0; r < rows; r++) {
            md += '| ' + Array.from({ length: cols }, function () { return '   '; }).join(' | ') + ' |\n';
        }
        insertBlock(md);
        tableModal.style.display = 'none';
    });

    // ========================================
    //  Image Modal
    // ========================================

    function openImageModal() {
        imageModal.style.display = 'flex';
        $('#imageAltInput').value = '';
        $('#imageUrlInput').value = '';
        $('#imageAsHeader').checked = false;
        state.selectedGalleryId = null;
        refreshModalGallery();
        switchTab('upload');
    }

    function switchTab(tab) {
        $$('.modal-tab').forEach(t => t.classList.remove('active'));
        $$('.modal-tab[data-tab="' + tab + '"]').forEach(t => t.classList.add('active'));
        $('#tabUpload').style.display = tab === 'upload' ? 'block' : 'none';
        $('#tabUrl').style.display = tab === 'url' ? 'block' : 'none';
        $('#tabGallery').style.display = tab === 'gallery' ? 'block' : 'none';
    }

    $$('.modal-tab').forEach(function (tab) {
        tab.addEventListener('click', function () { switchTab(this.dataset.tab); });
    });

    $('#imageModalClose').addEventListener('click', function () { imageModal.style.display = 'none'; });
    $('#imageModalCancel').addEventListener('click', function () { imageModal.style.display = 'none'; });
    imageModal.addEventListener('click', function (e) { if (e.target === imageModal) imageModal.style.display = 'none'; });

    // Drop zone drag-and-drop
    const dropZone = $('#dropZone');
    dropZone.addEventListener('dragover', function (e) { e.preventDefault(); this.style.borderColor = 'var(--accent)'; });
    dropZone.addEventListener('dragleave', function () { this.style.borderColor = ''; });
    dropZone.addEventListener('drop', function (e) {
        e.preventDefault();
        this.style.borderColor = '';
        if (e.dataTransfer.files.length) handleModalImageUpload(e.dataTransfer.files[0]);
    });
    dropZone.addEventListener('click', function () { $('#modalImageUpload').click(); });
    $('#modalImageUpload').addEventListener('change', function () {
        if (this.files.length) handleModalImageUpload(this.files[0]);
        this.value = '';
    });

    function handleModalImageUpload(file) {
        if (!file.type.startsWith('image/')) return;
        const reader = new FileReader();
        reader.onload = function (e) {
            const img = addImage(file.name, e.target.result, file, file.type);
            state.selectedGalleryId = img.id;
            $('#imageAltInput').value = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
            switchTab('gallery');
            refreshModalGallery();
            refreshImageGallery();
        };
        reader.readAsDataURL(file);
    }

    $('#imageModalInsert').addEventListener('click', function () {
        const alt = $('#imageAltInput').value || 'image';
        const isHeader = $('#imageAsHeader').checked;
        const activeTab = document.querySelector('.modal-tab.active').dataset.tab;
        let src = '';

        if (activeTab === 'url') {
            src = $('#imageUrlInput').value;
        } else if (state.selectedGalleryId) {
            const img = state.images.find(i => i.id === state.selectedGalleryId);
            if (img) src = img.name;
        }

        if (!src) {
            showToast('Please select or provide an image.', 'fa-exclamation-triangle');
            return;
        }

        const headerSuffix = isHeader ? '{header}' : '';
        insertAtCursor('![' + alt + '](' + src + ')' + headerSuffix, '', '');
        imageModal.style.display = 'none';
    });

    function refreshModalGallery() {
        const container = $('#modalGallery');
        if (state.images.length === 0) {
            container.innerHTML = '<p class="gallery-placeholder">No uploaded images yet.</p>';
            return;
        }
        container.innerHTML = '';
        state.images.forEach(function (img) {
            const item = document.createElement('div');
            item.className = 'modal-gallery-item' + (state.selectedGalleryId === img.id ? ' selected' : '');
            item.innerHTML = '<img src="' + img.dataUrl + '" alt="' + img.name + '">';
            item.addEventListener('click', function () {
                state.selectedGalleryId = img.id;
                $$('.modal-gallery-item').forEach(i => i.classList.remove('selected'));
                item.classList.add('selected');
                if (!$('#imageAltInput').value) {
                    $('#imageAltInput').value = img.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
                }
            });
            container.appendChild(item);
        });
    }

    // ========================================
    //  Image Management
    // ========================================

    let imageCounter = 0;

    function addImage(name, dataUrl, file, mimeType) {
        imageCounter++;
        const img = {
            id: 'img-' + imageCounter,
            name: name,
            dataUrl: dataUrl,
            file: file,
            mimeType: mimeType || 'image/png',
        };
        state.images.push(img);
        return img;
    }

    function removeImage(id) {
        state.images = state.images.filter(i => i.id !== id);
        refreshImageGallery();
    }

    // Upload via the panel button
    imageUploadInput.addEventListener('change', function () {
        Array.from(this.files).forEach(function (file) {
            if (!file.type.startsWith('image/')) return;
            const reader = new FileReader();
            reader.onload = function (e) {
                addImage(file.name, e.target.result, file, file.type);
                refreshImageGallery();
            };
            reader.readAsDataURL(file);
        });
        this.value = '';
    });

    function refreshImageGallery() {
        if (state.images.length === 0) {
            imageGallery.innerHTML = '<p class="gallery-placeholder">No images attached yet. Upload images to reference them in your post.</p>';
            return;
        }
        imageGallery.innerHTML = '';
        state.images.forEach(function (img) {
            const item = document.createElement('div');
            item.className = 'gallery-item';
            item.innerHTML =
                '<img src="' + img.dataUrl + '" alt="' + img.name + '">' +
                '<div class="gallery-item-info">' + img.name + '</div>' +
                '<div class="gallery-item-actions">' +
                    '<button class="gallery-action-btn copy-btn" title="Copy reference"><i class="fas fa-copy"></i></button>' +
                    '<button class="gallery-action-btn delete-btn" title="Remove"><i class="fas fa-trash"></i></button>' +
                '</div>';
            // Copy markdown reference
            item.querySelector('.copy-btn').addEventListener('click', function (e) {
                e.stopPropagation();
                insertAtCursor('![' + img.name.replace(/\.[^.]+$/, '') + '](' + img.name + ')', '', '');
                showToast('Image reference inserted');
            });
            // Delete
            item.querySelector('.delete-btn').addEventListener('click', function (e) {
                e.stopPropagation();
                removeImage(img.id);
            });
            imageGallery.appendChild(item);
        });
    }

    // ========================================
    //  Export — Markdown file
    // ========================================

    function getFilename() {
        let name = filenameInput.value.trim();
        if (!name) {
            const date = new Date().toISOString().slice(0, 10);
            name = date + '-blog-post';
        }
        // Sanitize
        name = name.replace(/[^a-zA-Z0-9_\-]/g, '-').replace(/-+/g, '-');
        return name;
    }

    function getExportableMarkdown() {
        let md = markdownInput.value;

        // Replace image references with proper export paths
        const filename = getFilename();
        const imgFolder = filename + '-images';

        state.images.forEach(function (img, index) {
            const ext = getExtension(img.mimeType);
            const exportName = filename + '-' + sanitizeImageName(img.name, index) + ext;
            // Replace all references to this image name with the export path
            const escapedName = img.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            md = md.replace(new RegExp('\\(!?' + escapedName + '\\)', 'g'), '(' + imgFolder + '/' + exportName + ')');
            // Also replace plain references
            md = md.replace(new RegExp('\\(' + escapedName + '\\)', 'g'), '(' + imgFolder + '/' + exportName + ')');
        });

        return md;
    }

    function sanitizeImageName(name, index) {
        let base = name.replace(/\.[^.]+$/, ''); // Remove extension
        base = base.replace(/[^a-zA-Z0-9_\-]/g, '-').replace(/-+/g, '-').toLowerCase();
        if (!base) base = 'image-' + (index + 1);
        return base;
    }

    function getExtension(mimeType) {
        const map = {
            'image/png': '.png',
            'image/jpeg': '.jpg',
            'image/gif': '.gif',
            'image/webp': '.webp',
            'image/svg+xml': '.svg',
            'image/bmp': '.bmp',
        };
        return map[mimeType] || '.png';
    }

    exportMdBtn.addEventListener('click', function () {
        const md = getExportableMarkdown();
        const filename = getFilename() + '.md';
        downloadFile(filename, md, 'text/markdown');
        showToast('Markdown file exported: ' + filename);
    });

    // ========================================
    //  Export — All (ZIP with images)
    // ========================================

    exportAllBtn.addEventListener('click', async function () {
        if (typeof JSZip === 'undefined') {
            showToast('JSZip library not loaded. Cannot create ZIP.', 'fa-exclamation-triangle');
            return;
        }

        const filename = getFilename();
        const imgFolder = filename + '-images';
        const zip = new JSZip();

        // Add markdown
        const md = getExportableMarkdown();
        zip.file(filename + '.md', md);

        // Add images
        if (state.images.length > 0) {
            const imgDir = zip.folder(imgFolder);
            state.images.forEach(function (img, index) {
                const ext = getExtension(img.mimeType);
                const exportName = filename + '-' + sanitizeImageName(img.name, index) + ext;
                // Convert dataURL to binary
                const base64 = img.dataUrl.split(',')[1];
                imgDir.file(exportName, base64, { base64: true });
            });
        }

        const blob = await zip.generateAsync({ type: 'blob' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename + '.zip';
        link.click();
        URL.revokeObjectURL(link.href);

        showToast('ZIP exported with ' + state.images.length + ' image(s)');
    });

    // ========================================
    //  Copy HTML
    // ========================================

    copyHtmlBtn.addEventListener('click', function () {
        const html = markdownPreview.innerHTML;
        navigator.clipboard.writeText(html).then(function () {
            showToast('HTML copied to clipboard');
        });
    });

    // ========================================
    //  Download helper
    // ========================================

    function downloadFile(filename, content, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.click();
        URL.revokeObjectURL(link.href);
    }

    // ========================================
    //  Toast
    // ========================================

    function showToast(message, icon) {
        const existing = document.querySelector('.toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.innerHTML = '<i class="fas ' + (icon || 'fa-check-circle') + '"></i> ' + message;
        document.body.appendChild(toast);

        setTimeout(function () { toast.remove(); }, 3000);
    }

    // ========================================
    //  Auto-save to localStorage
    // ========================================

    const STORAGE_KEY = 'idefixtools-md-editor';

    function saveToStorage() {
        const data = {
            content: markdownInput.value,
            filename: filenameInput.value,
            images: state.images.map(function (img) {
                return { id: img.id, name: img.name, dataUrl: img.dataUrl, mimeType: img.mimeType };
            }),
        };
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch (e) {
            // Storage might be full with large images — silently fail
        }
    }

    function loadFromStorage() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            const data = JSON.parse(raw);
            if (data.content) markdownInput.value = data.content;
            if (data.filename) filenameInput.value = data.filename;
            if (data.images && data.images.length) {
                data.images.forEach(function (img) {
                    imageCounter++;
                    state.images.push({
                        id: img.id || 'img-' + imageCounter,
                        name: img.name,
                        dataUrl: img.dataUrl,
                        mimeType: img.mimeType,
                        file: null,
                    });
                });
                refreshImageGallery();
            }
            updatePreview();
        } catch (e) {
            // Corrupt data — ignore
        }
    }

    // Save periodically
    setInterval(saveToStorage, 5000);

    // Save on page unload
    window.addEventListener('beforeunload', saveToStorage);

    // ========================================
    //  Drag-and-drop images onto the editor
    // ========================================

    markdownInput.addEventListener('dragover', function (e) {
        e.preventDefault();
        this.style.outline = '2px dashed var(--accent)';
    });

    markdownInput.addEventListener('dragleave', function () {
        this.style.outline = '';
    });

    markdownInput.addEventListener('drop', function (e) {
        e.preventDefault();
        this.style.outline = '';
        const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
        files.forEach(function (file) {
            const reader = new FileReader();
            reader.onload = function (ev) {
                const img = addImage(file.name, ev.target.result, file, file.type);
                refreshImageGallery();
                insertAtCursor('![' + file.name.replace(/\.[^.]+$/, '') + '](' + img.name + ')', '', '');
            };
            reader.readAsDataURL(file);
        });
    });

    // ========================================
    //  Init
    // ========================================

    loadFromStorage();
    updatePreview();

})();

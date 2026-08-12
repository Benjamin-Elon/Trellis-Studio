/**
 * Trellis Studio splash presentation.
 *
 * The licensing state machine remains in Draw.io's SplashDialog. This module
 * adds Trellis-owned structure, styling hooks, background loading, and
 * accessibility behavior after the application classes have loaded.
 */
(function() {
	var installed = false;
	var centeredDialogMaxWidth = 760;
	var centeredDialogMaxHeight = 760; // Fits the saved-license splash without accidental scroll.
	var centeredDialogMinWidth = 760;
	var centeredDialogMinHeight = 600;
	var preferredHorizontalMarginRatio = 0.12;
	var preferredVerticalMarginRatio = 0.08;
	var minimumHorizontalMarginRatio = 0.04;
	var minimumVerticalMarginRatio = 0.04;
	var defaultSplashBackgroundFilename = 'trellis-garden-sunrise.png';
	var splashAvatarStorageKey = 'trellis.splash.avatar.v1';
	var splashAvatarVersion = '1';
	var splashAvatarSize = 96;

	function addClass(element, className) {
		if (element == null) return;

		if (element.classList != null) {
			element.classList.add(className);
		} else {
			var currentClass = element.getAttribute('class') || '';
			if ((' ' + currentClass + ' ').indexOf(' ' + className + ' ') < 0) {
				element.setAttribute('class', currentClass + (currentClass.length > 0 ? ' ' : '') + className);
			}
		}
	}

	function removeClass(element, className) {
		if (element == null) return;

		if (element.classList != null) {
			element.classList.remove(className);
		} else {
			var currentClass = ' ' + (element.getAttribute('class') || '') + ' ';
			element.setAttribute('class', currentClass.replace(' ' + className + ' ', ' ').replace(/^\s+|\s+$/g, ''));
		}
	}

	function createIcon(documentRef, name) {
		var svg = documentRef.createElementNS('http://www.w3.org/2000/svg', 'svg');
		var paths = {
			create: ['M6 3h8l5 5v13H6z', 'M14 3v5h5', 'M12.5 11v6', 'M9.5 14h6'],
			open: ['M3 7h7l2 2h9v10H3z', 'M3 7V5h7l2 2'],
			support: ['M12 21s-7-4.6-7-10a4 4 0 0 1 7-2.7A4 4 0 0 1 19 11c0 5.4-7 10-7 10z'],
			user: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M4 21a8 8 0 0 1 16 0']
		};

		svg.setAttribute('viewBox', '0 0 24 24');
		svg.setAttribute('aria-hidden', 'true');
		svg.setAttribute('focusable', 'false');
		addClass(svg, 'trellis-splash-icon');

		for (var i = 0; i < paths[name].length; i++) {
			var path = documentRef.createElementNS('http://www.w3.org/2000/svg', 'path');
			path.setAttribute('d', paths[name][i]);
			svg.appendChild(path);
		}

		return svg;
	}

	function prependButtonIcon(button, iconName) {
		if (button.querySelector('.trellis-splash-icon') == null) {
			button.insertBefore(createIcon(button.ownerDocument, iconName), button.firstChild);
		}
	}

	function getDirectCloseButton(container) {
		for (var i = 0; container != null && i < container.children.length; i++) {
			if ((' ' + container.children[i].className + ' ').indexOf(' geButton ') >= 0) {
				return container.children[i];
			}
		}

		return null;
	}

	function updateCloseLabel(splashDialog, outerDialog) {
		var closeButton = getDirectCloseButton(outerDialog != null ? outerDialog.container : null);

		if (closeButton != null) {
			var isComplete = splashDialog.isTrellisLicenseWizardComplete == null ||
				splashDialog.isTrellisLicenseWizardComplete();
			var label = isComplete ? 'Continue with a blank diagram' : 'Exit Trellis Studio';
			closeButton.setAttribute('title', label);
			closeButton.setAttribute('aria-label', label);
		}
	}

	function getStorage() {
		try {
			return typeof window != 'undefined' && window.localStorage ? window.localStorage : null;
		} catch (e) {
			return null;
		}
	}

	function isValidAvatarDataUrl(dataUrl) {
		return typeof dataUrl == 'string' &&
			/^data:image\/(?:png|jpeg|webp);base64,/i.test(dataUrl);
	}

	function normalizeAvatarRecord(record) {
		if (record == null || record.version != splashAvatarVersion ||
			!isValidAvatarDataUrl(record.dataUrl)) {
			return null;
		}

		return {
			version: splashAvatarVersion,
			dataUrl: record.dataUrl,
			mimeType: record.mimeType || 'image/png',
			updatedAt: record.updatedAt || ''
		};
	}

	function readAvatarRecord() {
		var storage = getStorage();

		if (storage == null) return null;

		try {
			return normalizeAvatarRecord(JSON.parse(storage.getItem(splashAvatarStorageKey) || 'null'));
		} catch (e) {
			return null;
		}
	}

	function writeAvatarRecord(dataUrl) {
		var storage = getStorage();
		var record = {
			version: splashAvatarVersion,
			dataUrl: dataUrl,
			mimeType: 'image/png',
			updatedAt: new Date().toISOString()
		};

		if (storage == null) return false;

		try {
			storage.setItem(splashAvatarStorageKey, JSON.stringify(record));
			return true;
		} catch (e) {
			return false;
		}
	}

	function clearAvatarRecord() {
		var storage = getStorage();

		if (storage == null) return;

		try {
			storage.removeItem(splashAvatarStorageKey);
		} catch (e) {
			// Ignore storage failures while restoring the visible placeholder.
		}
	}

	function showAvatarError(documentRef, message) {
		var ownerWindow = documentRef != null ? documentRef.defaultView : null;

		if (ownerWindow != null && typeof ownerWindow.alert == 'function') {
			ownerWindow.alert(message);
		} else if (typeof window != 'undefined' && typeof window.alert == 'function') {
			window.alert(message);
		}
	}

	function isSupportedAvatarFile(file) {
		var type = file != null && file.type ? file.type.toLowerCase() : '';
		var name = file != null && file.name ? file.name : '';

		return file != null && file.size !== 0 &&
			(/image\/(?:png|jpeg|webp)/.test(type) || /\.(png|jpe?g|webp)$/i.test(name));
	}

	function cropAvatarDataUrl(documentRef, sourceDataUrl, callback, errorCallback) {
		var ownerWindow = documentRef != null ? documentRef.defaultView : window;
		var image = new ownerWindow.Image();

		image.onload = function() {
			try {
				var canvas = documentRef.createElement('canvas');
				var context = canvas.getContext != null ? canvas.getContext('2d') : null;
				var sourceWidth = image.naturalWidth || image.width;
				var sourceHeight = image.naturalHeight || image.height;
				var cropSize = Math.min(sourceWidth, sourceHeight);
				var cropX = Math.max(0, (sourceWidth - cropSize) / 2);
				var cropY = Math.max(0, (sourceHeight - cropSize) / 2);

				if (context == null || cropSize <= 0 || canvas.toDataURL == null) {
					throw new Error('Canvas unavailable');
				}

				canvas.width = splashAvatarSize;
				canvas.height = splashAvatarSize;
				context.clearRect(0, 0, splashAvatarSize, splashAvatarSize);
				context.drawImage(image, cropX, cropY, cropSize, cropSize, 0, 0, splashAvatarSize, splashAvatarSize);
				callback(canvas.toDataURL('image/png'));
			} catch (e) {
				errorCallback(e);
			}
		};
		image.onerror = function(error) {
			errorCallback(error);
		};
		image.src = sourceDataUrl;
	}

	function saveAvatarFile(documentRef, file, onSaved) {
		if (!isSupportedAvatarFile(file)) {
			showAvatarError(documentRef, 'Choose a PNG, JPEG, or WebP image for your avatar.');
			return;
		}

		try {
			var ownerWindow = documentRef != null ? documentRef.defaultView : window;
			var reader = new ownerWindow.FileReader();
			reader.onload = function(event) {
				cropAvatarDataUrl(documentRef, event.target.result, function(dataUrl) {
					if (!writeAvatarRecord(dataUrl)) {
						showAvatarError(documentRef, 'Could not save the avatar on this device.');
						return;
					}
					onSaved();
				}, function() {
					showAvatarError(documentRef, 'Could not read that avatar image.');
				});
			};
			reader.onerror = function() {
				showAvatarError(documentRef, 'Could not read that avatar image.');
			};
			reader.readAsDataURL(file);
		} catch (e) {
			showAvatarError(documentRef, 'Could not read that avatar image.');
		}
	}

	function renderAvatarControl(control) {
		var record = readAvatarRecord();
		var image = control.querySelector('.trellis-avatar-image');
		var placeholder = control.querySelector('.trellis-avatar-placeholder-icon');
		var remove = control.parentNode != null ? control.parentNode.querySelector('.trellis-avatar-remove') : null;

		if (record != null) {
			if (image == null) {
				image = control.ownerDocument.createElement('img');
				image.className = 'trellis-avatar-image';
				image.alt = '';
				image.setAttribute('aria-hidden', 'true');
				control.appendChild(image);
			}
			image.src = record.dataUrl;
			if (placeholder != null) placeholder.style.display = 'none';
			if (remove != null) remove.hidden = false;
			control.setAttribute('aria-label', 'Change avatar');
			control.setAttribute('title', 'Change avatar');
		} else {
			if (image != null && image.parentNode != null) image.parentNode.removeChild(image);
			if (placeholder != null) placeholder.style.display = '';
			if (remove != null) remove.hidden = true;
			control.setAttribute('aria-label', 'Set avatar');
			control.setAttribute('title', 'Set avatar');
		}
	}

	function openAvatarPicker(control) {
		var documentRef = control.ownerDocument;
		var input = control.trellisAvatarInput;

		if (input == null) {
			input = documentRef.createElement('input');
			input.type = 'file';
			input.accept = 'image/png,image/jpeg,image/webp';
			input.className = 'trellis-avatar-file-input';
			input.addEventListener('change', function() {
				var file = input.files != null ? input.files[0] : null;

				if (file != null) {
					saveAvatarFile(documentRef, file, function() {
						renderAvatarControl(control);
					});
				}

				input.value = '';
			});
			control.trellisAvatarInput = input;
		}

		input.click();
	}

	function createAvatarControl(documentRef) {
		var wrap = documentRef.createElement('div');
		var control = documentRef.createElement('button');
		var placeholder = createIcon(documentRef, 'user');
		var remove = documentRef.createElement('button');

		wrap.className = 'trellis-avatar-wrap';
		control.className = 'trellis-license-icon trellis-avatar-control';
		control.type = 'button';
		addClass(placeholder, 'trellis-avatar-placeholder-icon');
		control.appendChild(placeholder);
		control.addEventListener('click', function(evt) {
			if (evt != null && evt.stopPropagation != null) evt.stopPropagation();
			openAvatarPicker(control);
		});

		remove.className = 'trellis-avatar-remove';
		remove.type = 'button';
		remove.textContent = '\u00d7';
		remove.setAttribute('aria-label', 'Remove avatar');
		remove.setAttribute('title', 'Remove avatar');
		remove.addEventListener('click', function(evt) {
			if (evt != null && evt.preventDefault != null) evt.preventDefault();
			if (evt != null && evt.stopPropagation != null) evt.stopPropagation();
			clearAvatarRecord();
			renderAvatarControl(control);
		});

		wrap.appendChild(control);
		wrap.appendChild(remove);
		renderAvatarControl(control);
		return wrap;
	}

	function ensureSavedLicenseAvatar(section) {
		var existingControl = section.querySelector('.trellis-avatar-control');

		if (existingControl != null) {
			renderAvatarControl(existingControl);
			return;
		}

		var existingIcon = section.querySelector('.trellis-license-icon');
		var avatar = createAvatarControl(section.ownerDocument);

		if (existingIcon != null && existingIcon.parentNode != null) {
			existingIcon.parentNode.replaceChild(avatar, existingIcon);
		} else {
			section.insertBefore(avatar, section.firstChild);
		}
	}

	function decorateSavedLicenseCard(container) {
		var sections = container.querySelectorAll('.trellis-splash-section, .trellis-saved-license-card');
		var foundSavedCard = false;

		for (var i = 0; i < sections.length; i++) {
			var heading = sections[i].firstElementChild;

			if (heading != null && (heading.textContent == 'Saved license path' || heading.textContent == 'Saved license')) {
				foundSavedCard = true;
				heading.textContent = 'Saved license';
				addClass(heading, 'trellis-saved-license-heading');
				addClass(sections[i], 'trellis-saved-license-card');
				var copy = heading.nextElementSibling;

				if (copy != null && !copy.classList.contains('trellis-saved-license-copy')) {
					var savedText = copy.textContent;
					var signerMarker = '. Signed by ';
					var signerIndex = savedText.indexOf(signerMarker);
					addClass(copy, 'trellis-saved-license-copy');

					if (signerIndex >= 0) {
						copy.textContent = '';
						var pathLine = container.ownerDocument.createElement('div');
						var signerLine = container.ownerDocument.createElement('div');
						var signerText = 'Signed by ' + savedText.substring(signerIndex + signerMarker.length);
						if (/\.\.$/.test(signerText)) signerText = signerText.substring(0, signerText.length - 1);
						pathLine.className = 'trellis-saved-license-path';
						signerLine.className = 'trellis-saved-license-signer';
						pathLine.textContent = savedText.substring(0, signerIndex + 1);
						signerLine.textContent = signerText;
						copy.appendChild(pathLine);
						copy.appendChild(signerLine);
					}
				}

				ensureSavedLicenseAvatar(sections[i]);
			}
		}

		return foundSavedCard;
	}

	function decorateButtons(container) {
		var buttons = container.querySelectorAll('button');

		for (var i = 0; i < buttons.length; i++) {
			buttons[i].setAttribute('type', 'button');

			if (buttons[i].textContent.indexOf('Explore & Support My Projects') >= 0) {
				addClass(buttons[i], 'trellis-support-action');
				prependButtonIcon(buttons[i], 'support');
			} else if (buttons[i].textContent.indexOf('Create New Diagram') >= 0) {
				addClass(buttons[i], 'trellis-primary-action');
				addClass(buttons[i], 'trellis-button-add');
				addClass(buttons[i], 'trellis-button-filled');
				prependButtonIcon(buttons[i], 'create');
			} else if (buttons[i].textContent.indexOf('Open Existing Diagram') >= 0) {
				addClass(buttons[i], 'trellis-secondary-action');
				addClass(buttons[i], 'trellis-button-open');
				prependButtonIcon(buttons[i], 'open');
			} else if (buttons[i].textContent.indexOf('Change license') >= 0) {
				addClass(buttons[i], 'trellis-change-license');
				addClass(buttons[i], 'trellis-button-neutral');
			}
		}
	}

	function decorateRenderedState(splashDialog) {
		var container = splashDialog.container;
		var center = container.querySelector('.trellis-splash-center');

		if (center != null && center.firstElementChild != null) {
			center.firstElementChild.setAttribute('role', 'heading');
			center.firstElementChild.setAttribute('aria-level', '1');

			if (center.querySelector('.trellis-splash-tagline') == null) {
				var insertBeforeNode = center.children.length > 1 ? center.children[1] : null;
				var stateIntro = insertBeforeNode;
				if (stateIntro != null && ((' ' + stateIntro.className + ' ').indexOf(' trellis-splash-section ') >= 0 || (' ' + stateIntro.className + ' ').indexOf(' trellis-license-contact-panel ') >= 0 || (' ' + stateIntro.className + ' ').indexOf(' trellis-saved-license-card ') >= 0)) stateIntro = null;
				var tagline = container.ownerDocument.createElement('div');
				tagline.className = 'trellis-splash-tagline';
				tagline.textContent = 'Build systems that grow.';
				if (stateIntro != null) addClass(stateIntro, 'trellis-splash-state-intro');
				center.insertBefore(tagline, insertBeforeNode);
			}
		}

		var savedState = decorateSavedLicenseCard(container);
		var stateIntro = container.querySelector('.trellis-splash-state-intro');
		if (stateIntro != null) stateIntro.hidden = savedState;

		if (savedState) {
			addClass(container, 'trellis-saved-state');
		} else {
			removeClass(container, 'trellis-saved-state');
		}
		decorateButtons(container);
		addClass(container.querySelector('.trellis-splash-actions') != null ?
			container.querySelector('.trellis-splash-actions').parentNode : null, 'trellis-splash-buttons');

		if (splashDialog.trellisOuterDialog != null) {
			updateCloseLabel(splashDialog, splashDialog.trellisOuterDialog);
		}
	}

	function removeLanguageControl(container) {
		var languageControls = container.querySelectorAll('.geAdaptiveAsset');

		for (var i = 0; i < languageControls.length; i++) {
			if (languageControls[i].parentNode == container) {
				container.removeChild(languageControls[i]);
			}
		}
	}

	function enhanceSplashDialog(baseSplashDialog, editorUi) {
		addClass(baseSplashDialog.container, 'trellis-splash-root');
		baseSplashDialog.container.trellisSplashDialog = baseSplashDialog;
		removeLanguageControl(baseSplashDialog.container);
		decorateRenderedState(baseSplashDialog);
		baseSplashDialog.container.addEventListener('click', function() {
			decorateRenderedState(baseSplashDialog);
		});
		return baseSplashDialog;
	}

	function isSafeBackgroundFilename(filename) {
		return typeof filename == 'string' && filename.length > 0 &&
			filename == filename.replace(/^.*[\\\\\/]/, '') && /\.(webp|jpe?g|png)$/i.test(filename);
	}

	function getSplashImagePath() {
		return typeof IMAGE_PATH != 'undefined' && IMAGE_PATH ? IMAGE_PATH : 'images';
	}

	function getSplashBackgroundLayer(backdrop) {
		if (backdrop == null || typeof document == 'undefined' || document.createElement == null) return null;
		var layer = backdrop.querySelector != null ? backdrop.querySelector('.trellis-splash-bg-image') : null;

		if (layer == null) {
			layer = document.createElement('img');
			layer.className = 'trellis-splash-bg-image';
			layer.alt = '';
			layer.setAttribute('aria-hidden', 'true');
			layer.draggable = false;
			if (backdrop.insertBefore != null) backdrop.insertBefore(layer, backdrop.firstChild);
			else if (backdrop.appendChild != null) backdrop.appendChild(layer);
		}

		return layer;
	}

	function scheduleSplashBackgroundReveal(backdrop) {
		var ownerWindow = backdrop != null && backdrop.ownerDocument != null ? backdrop.ownerDocument.defaultView : null;

		if (ownerWindow != null && typeof ownerWindow.requestAnimationFrame == 'function') {
			ownerWindow.requestAnimationFrame(function() {
				addClass(backdrop, 'trellis-splash-has-image');
			});
		} else {
			addClass(backdrop, 'trellis-splash-has-image');
		}
	}

	function applyBackgroundFilename(backdrop, filename) {
		if (backdrop == null || !isSafeBackgroundFilename(filename)) {
			return;
		}
		if (window.Image == null) {
			return;
		}
		if (backdrop.trellisSplashBackgroundFilename == filename ||
			backdrop.trellisSplashPendingBackgroundFilename == filename) {
			return;
		}

		var imagePath = getSplashImagePath();
		var backgroundUrl = imagePath + '/trellis-splash/' + encodeURIComponent(filename);
		var image = new window.Image();
		image.decoding = 'async';
		image.onload = function() {
			if (backdrop.trellisSplashPendingBackgroundFilename != filename) return;
			var layer = getSplashBackgroundLayer(backdrop);
			if (layer == null) return;
			layer.onload = function() {
				if (backdrop.trellisSplashPendingBackgroundFilename != filename &&
					backdrop.trellisSplashBackgroundFilename != filename) return;
				backdrop.trellisSplashPendingBackgroundFilename = null;
				backdrop.trellisSplashBackgroundFilename = filename;
				scheduleSplashBackgroundReveal(backdrop);
			};
			layer.onerror = function() {
				if (backdrop.trellisSplashPendingBackgroundFilename == filename) {
					backdrop.trellisSplashPendingBackgroundFilename = null;
				}
				if (!backdrop.style.getPropertyValue('--trellis-splash-image')) {
					removeClass(backdrop, 'trellis-splash-has-image');
					layer.removeAttribute('src');
				}
			};
			backdrop.style.setProperty('--trellis-splash-image', 'url("' + backgroundUrl + '")');
			layer.src = backgroundUrl;
		};
		image.onerror = function(event) {
			if (backdrop.trellisSplashPendingBackgroundFilename == filename) {
				backdrop.trellisSplashPendingBackgroundFilename = null;
			}
			if (!backdrop.style.getPropertyValue('--trellis-splash-image')) {
				backdrop.style.removeProperty('--trellis-splash-image');
				removeClass(backdrop, 'trellis-splash-has-image');
				var layer = backdrop.querySelector != null ? backdrop.querySelector('.trellis-splash-bg-image') : null;
				if (layer != null) layer.removeAttribute('src');
			}
		};
		getSplashBackgroundLayer(backdrop);
		backdrop.trellisSplashPendingBackgroundFilename = filename;
		image.src = backgroundUrl;
	}

	function requestBackground(backdrop) {
		applyBackgroundFilename(backdrop, defaultSplashBackgroundFilename);
		if (typeof electron == 'undefined' || electron.request == null) {
			return;
		}

		electron.request({ action: 'getTrellisSplashBackground' }, function(filename) {
			applyBackgroundFilename(backdrop, filename);
		}, function(error) {
			if (!backdrop.style.getPropertyValue('--trellis-splash-image')) {
				backdrop.style.removeProperty('--trellis-splash-image');
			}
		});
	}

	function getWorkspaceBounds(editorUi) {
		var workspace = editorUi.diagramContainer;
		var bounds = workspace != null && workspace.getBoundingClientRect != null ?
			workspace.getBoundingClientRect() : null;
		var documentElement = document.documentElement;
		var viewportWidth = documentElement != null && documentElement.clientWidth > 0 ?
			documentElement.clientWidth : (window.innerWidth || 0);
		var viewportHeight = documentElement != null && documentElement.clientHeight > 0 ?
			documentElement.clientHeight : (window.innerHeight || 0);
		var left = bounds != null && isFinite(bounds.left) ? Math.max(0, bounds.left) : 0;
		var top = bounds != null && isFinite(bounds.top) ? Math.max(0, bounds.top) : 0;
		var width = bounds != null && isFinite(bounds.width) && bounds.width > 0 ?
			bounds.width : Math.max(0, viewportWidth - left);
		var height = bounds != null && isFinite(bounds.height) && bounds.height > 0 ?
			bounds.height : Math.max(0, viewportHeight - top);

		return { left: left, top: top, width: width, height: height };
	}

	function clampSplashSize(preferredSize, minimumSize, maximumSize) {
		return Math.max(minimumSize, Math.min(maximumSize, preferredSize));
	}

	function calculateSplashLayout(bounds) {
		var preferredWidth = bounds.width * (1 - preferredHorizontalMarginRatio * 2);
		var preferredHeight = bounds.height * (1 - preferredVerticalMarginRatio * 2);
		var minimumMarginWidth = bounds.width * minimumHorizontalMarginRatio * 2;
		var minimumMarginHeight = bounds.height * minimumVerticalMarginRatio * 2;
		var compact = bounds.width - minimumMarginWidth < centeredDialogMinWidth ||
			bounds.height - minimumMarginHeight < centeredDialogMinHeight;

		return {
			compact: compact,
			width: compact ? bounds.width : clampSplashSize(preferredWidth, centeredDialogMinWidth, centeredDialogMaxWidth),
			height: compact ? bounds.height : clampSplashSize(preferredHeight, centeredDialogMinHeight, centeredDialogMaxHeight)
		};
	}

	function applyWorkspaceLayout(editorUi, outerDialog) {
		var bounds = getWorkspaceBounds(editorUi);
		var layout = calculateSplashLayout(bounds);
		var targets = [outerDialog.container, outerDialog.bg];

		for (var i = 0; i < targets.length; i++) {
			if (targets[i] == null) continue;
			targets[i].style.setProperty('--trellis-workspace-left', bounds.left + 'px');
			targets[i].style.setProperty('--trellis-workspace-top', bounds.top + 'px');
			targets[i].style.setProperty('--trellis-workspace-width', bounds.width + 'px');
			targets[i].style.setProperty('--trellis-workspace-height', bounds.height + 'px');
			targets[i].style.setProperty('--trellis-workspace-center-x', (bounds.left + bounds.width / 2) + 'px');
			targets[i].style.setProperty('--trellis-workspace-center-y', (bounds.top + bounds.height / 2) + 'px');
			targets[i].style.setProperty('--trellis-splash-dialog-width', layout.width + 'px');
			targets[i].style.setProperty('--trellis-splash-dialog-height', layout.height + 'px');
		}

		if (layout.compact) addClass(outerDialog.container, 'trellis-splash-compact');
		else removeClass(outerDialog.container, 'trellis-splash-compact');
	}

	function setSplashChromeActive(editorUi, active) {
		if (editorUi == null || editorUi.container == null) return;
		if (active) addClass(editorUi.container, 'trellis-splash-active');
		else removeClass(editorUi.container, 'trellis-splash-active');
	}

	function decorateOuterDialog(editorUi, splashDialog, outerDialog) {
		addClass(outerDialog.container, 'trellis-splash-dialog');
		addClass(outerDialog.bg, 'trellis-splash-backdrop');
		setSplashChromeActive(editorUi, true);
		applyWorkspaceLayout(editorUi, outerDialog);
		splashDialog.trellisOuterDialog = outerDialog;
		updateCloseLabel(splashDialog, outerDialog);
		requestBackground(outerDialog.bg);

		if (outerDialog.trellisSplashCleanup != null) outerDialog.trellisSplashCleanup();
		var disposed = false;
		var resizeHandler = function() { applyWorkspaceLayout(editorUi, outerDialog); };
		var cleanup = function() {
			if (disposed) return;
			disposed = true;
			window.removeEventListener('resize', resizeHandler);
			outerDialog.trellisSplashCleanup = null;
		};
		window.addEventListener('resize', resizeHandler);
		outerDialog.trellisSplashCleanup = cleanup;

		if (typeof outerDialog.close == 'function' && !outerDialog.trellisSplashCloseWrapped) {
			var baseClose = outerDialog.close;
			outerDialog.close = function() {
				var result = baseClose.apply(this, arguments);
				if (result !== false) {
					if (typeof this.trellisSplashCleanup == 'function') this.trellisSplashCleanup();
					setSplashChromeActive(editorUi, false);
				}
				return result;
			};
			outerDialog.trellisSplashCloseWrapped = true;
		}
	}

	function install() {
		if (installed || typeof SplashDialog == 'undefined') return;
		installed = true;

		var BaseSplashDialog = SplashDialog;
		SplashDialog = function(editorUi) {
			return enhanceSplashDialog(new BaseSplashDialog(editorUi), editorUi);
		};

		if (typeof App != 'undefined' && App.prototype != null && App.prototype.showDialog != null) {
			var baseShowDialog = App.prototype.showDialog;
			App.prototype.showDialog = function(element) {
				var result = baseShowDialog.apply(this, arguments);

				if (element != null && element.trellisSplashDialog != null && this.dialog != null) {
					decorateOuterDialog(this, element.trellisSplashDialog, this.dialog);
				}

				return result;
			};
		}
	}

	window.TrellisSplashEnhancements = {
		install: install,
		enhanceSplashDialog: enhanceSplashDialog,
		decorateOuterDialog: decorateOuterDialog,
		isSafeBackgroundFilename: isSafeBackgroundFilename
	};
})();

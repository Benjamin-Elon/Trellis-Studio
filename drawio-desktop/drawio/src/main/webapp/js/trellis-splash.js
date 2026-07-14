/**
 * Trellis Studio splash presentation.
 *
 * The licensing state machine remains in Draw.io's SplashDialog. This module
 * adds Trellis-owned structure, styling hooks, background loading, and
 * accessibility behavior after the application classes have loaded.
 */
(function() { // NEW
	var installed = false; // NEW
	var centeredDialogWidth = 760; // NEW
	var centeredDialogHeight = 690; // NEW
	var centeredDialogMargin = 12; // NEW

	function addClass(element, className) { // NEW
		if (element == null) return; // NEW

		if (element.classList != null) { // NEW
			element.classList.add(className); // NEW
		} else { // NEW
			var currentClass = element.getAttribute('class') || ''; // NEW
			if ((' ' + currentClass + ' ').indexOf(' ' + className + ' ') < 0) { // NEW
				element.setAttribute('class', currentClass + (currentClass.length > 0 ? ' ' : '') + className); // NEW
			} // NEW
		} // NEW
	} // NEW

	function removeClass(element, className) { // NEW
		if (element == null) return; // NEW

		if (element.classList != null) { // NEW
			element.classList.remove(className); // NEW
		} else { // NEW
			var currentClass = ' ' + (element.getAttribute('class') || '') + ' '; // NEW
			element.setAttribute('class', currentClass.replace(' ' + className + ' ', ' ').replace(/^\s+|\s+$/g, '')); // NEW
		} // NEW
	} // NEW

	function createIcon(documentRef, name) { // NEW
		var svg = documentRef.createElementNS('http://www.w3.org/2000/svg', 'svg'); // NEW
		var paths = { // NEW
			create: ['M6 3h8l5 5v13H6z', 'M14 3v5h5', 'M12.5 11v6', 'M9.5 14h6'], // NEW
			open: ['M3 7h7l2 2h9v10H3z', 'M3 7V5h7l2 2'], // NEW
			help: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M9.7 9a2.4 2.4 0 1 1 3.5 2.1c-.9.5-1.2 1-1.2 2', 'M12 17h.01'], // NEW
			user: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M4 21a8 8 0 0 1 16 0'] // NEW
		}; // NEW

		svg.setAttribute('viewBox', '0 0 24 24'); // NEW
		svg.setAttribute('aria-hidden', 'true'); // NEW
		svg.setAttribute('focusable', 'false'); // NEW
		addClass(svg, 'trellis-splash-icon'); // NEW

		for (var i = 0; i < paths[name].length; i++) { // NEW
			var path = documentRef.createElementNS('http://www.w3.org/2000/svg', 'path'); // NEW
			path.setAttribute('d', paths[name][i]); // NEW
			svg.appendChild(path); // NEW
		} // NEW

		return svg; // NEW
	} // NEW

	function prependButtonIcon(button, iconName) { // NEW
		if (button.querySelector('.trellis-splash-icon') == null) { // NEW
			button.insertBefore(createIcon(button.ownerDocument, iconName), button.firstChild); // NEW
		} // NEW
	} // NEW

	function getDirectCloseButton(container) { // NEW
		for (var i = 0; container != null && i < container.children.length; i++) { // NEW
			if ((' ' + container.children[i].className + ' ').indexOf(' geButton ') >= 0) { // NEW
				return container.children[i]; // NEW
			} // NEW
		} // NEW

		return null; // NEW
	} // NEW

	function updateCloseLabel(splashDialog, outerDialog) { // NEW
		var closeButton = getDirectCloseButton(outerDialog != null ? outerDialog.container : null); // NEW

		if (closeButton != null) { // NEW
			var isComplete = splashDialog.isTrellisLicenseWizardComplete == null || // NEW
				splashDialog.isTrellisLicenseWizardComplete(); // NEW
			var label = isComplete ? 'Continue with a blank diagram' : 'Exit Trellis Studio'; // NEW
			closeButton.setAttribute('title', label); // NEW
			closeButton.setAttribute('aria-label', label); // NEW
		} // NEW
	} // NEW

	function decorateSavedLicenseCard(container) { // NEW
		var sections = container.querySelectorAll('.trellis-splash-section'); // NEW
		var foundSavedCard = false; // NEW

		for (var i = 0; i < sections.length; i++) { // NEW
			var heading = sections[i].firstElementChild; // NEW

			if (heading != null && (heading.textContent == 'Saved license path' || heading.textContent == 'Saved license')) { // NEW
				foundSavedCard = true; // NEW
				heading.textContent = 'Saved license'; // CHANGE
				addClass(heading, 'trellis-saved-license-heading'); // NEW
				addClass(sections[i], 'trellis-saved-license-card'); // NEW
				var copy = heading.nextElementSibling; // NEW

				if (copy != null && !copy.classList.contains('trellis-saved-license-copy')) { // NEW
					var savedText = copy.textContent; // NEW
					var signerMarker = '. Signed by '; // NEW
					var signerIndex = savedText.indexOf(signerMarker); // NEW
					addClass(copy, 'trellis-saved-license-copy'); // NEW

					if (signerIndex >= 0) { // NEW
						copy.textContent = ''; // NEW
						var pathLine = container.ownerDocument.createElement('div'); // NEW
						var signerLine = container.ownerDocument.createElement('div'); // NEW
						var signerText = 'Signed by ' + savedText.substring(signerIndex + signerMarker.length); // NEW
						if (/\.\.$/.test(signerText)) signerText = signerText.substring(0, signerText.length - 1); // NEW
						pathLine.className = 'trellis-saved-license-path'; // NEW
						signerLine.className = 'trellis-saved-license-signer'; // NEW
						pathLine.textContent = savedText.substring(0, signerIndex + 1); // NEW
						signerLine.textContent = signerText; // NEW
						copy.appendChild(pathLine); // NEW
						copy.appendChild(signerLine); // NEW
					} // NEW
				} // NEW

				if (sections[i].querySelector('.trellis-license-icon') == null) { // NEW
					var icon = createIcon(container.ownerDocument, 'user'); // NEW
					addClass(icon, 'trellis-license-icon'); // NEW
					sections[i].insertBefore(icon, heading); // NEW
				} // NEW
			} // NEW
		} // NEW

		return foundSavedCard; // NEW
	} // NEW

	function decorateButtons(container) { // NEW
		var buttons = container.querySelectorAll('button'); // NEW

		for (var i = 0; i < buttons.length; i++) { // NEW
			buttons[i].setAttribute('type', 'button'); // NEW

			if (buttons[i].textContent.indexOf('Create New Diagram') >= 0) { // NEW
				addClass(buttons[i], 'trellis-primary-action'); // NEW
				prependButtonIcon(buttons[i], 'create'); // NEW
			} else if (buttons[i].textContent.indexOf('Open Existing Diagram') >= 0) { // NEW
				addClass(buttons[i], 'trellis-secondary-action'); // NEW
				prependButtonIcon(buttons[i], 'open'); // NEW
			} else if (buttons[i].textContent.indexOf('Change license') >= 0) { // NEW
				addClass(buttons[i], 'trellis-change-license'); // NEW
			} // NEW
		} // NEW
	} // NEW

	function decorateRenderedState(splashDialog) { // NEW
		var container = splashDialog.container; // NEW
		var center = container.querySelector('.trellis-splash-center'); // NEW

		if (center != null && center.firstElementChild != null) { // NEW
			center.firstElementChild.setAttribute('role', 'heading'); // NEW
			center.firstElementChild.setAttribute('aria-level', '1'); // NEW

			if (center.querySelector('.trellis-splash-tagline') == null) { // NEW
				var stateIntro = center.children.length > 1 ? center.children[1] : null; // NEW
				var tagline = container.ownerDocument.createElement('div'); // NEW
				tagline.className = 'trellis-splash-tagline'; // NEW
				tagline.textContent = 'Build systems that grow.'; // NEW
				if (stateIntro != null) addClass(stateIntro, 'trellis-splash-state-intro'); // NEW
				center.insertBefore(tagline, stateIntro); // NEW
			} // NEW
		} // NEW

		var savedState = decorateSavedLicenseCard(container); // NEW
		var stateIntro = container.querySelector('.trellis-splash-state-intro'); // NEW
		if (stateIntro != null) stateIntro.hidden = savedState; // NEW

		if (savedState) { // NEW
			addClass(container, 'trellis-saved-state'); // NEW
		} else { // NEW
			removeClass(container, 'trellis-saved-state'); // NEW
		} // NEW
		decorateButtons(container); // NEW
		addClass(container.querySelector('.trellis-splash-actions') != null ? // NEW
			container.querySelector('.trellis-splash-actions').parentNode : null, 'trellis-splash-buttons'); // NEW

		if (splashDialog.trellisOuterDialog != null) { // NEW
			updateCloseLabel(splashDialog, splashDialog.trellisOuterDialog); // NEW
		} // NEW
	} // NEW

	function createHelpFooter(editorUi, container) { // NEW
		var action = editorUi.actions != null && editorUi.actions.get != null ? // NEW
			editorUi.actions.get('trellisUpdatesLinks') : null; // NEW

		if (action == null || action.funct == null) return; // NEW

		var footer = container.ownerDocument.createElement('div'); // NEW
		var helpButton = container.ownerDocument.createElement('button'); // NEW
		footer.className = 'trellis-splash-footer'; // NEW
		helpButton.className = 'trellis-splash-help'; // NEW
		helpButton.setAttribute('type', 'button'); // NEW
		helpButton.appendChild(createIcon(container.ownerDocument, 'help')); // NEW
		helpButton.appendChild(container.ownerDocument.createTextNode('Help')); // NEW
		helpButton.addEventListener('click', function() { action.funct(); }); // NEW
		footer.appendChild(helpButton); // NEW
		container.appendChild(footer); // NEW
	} // NEW

	function removeLanguageControl(container) { // NEW
		var languageControls = container.querySelectorAll('.geAdaptiveAsset'); // NEW

		for (var i = 0; i < languageControls.length; i++) { // NEW
			if (languageControls[i].parentNode == container) { // NEW
				container.removeChild(languageControls[i]); // NEW
			} // NEW
		} // NEW
	} // NEW

	function enhanceSplashDialog(baseSplashDialog, editorUi) { // NEW
		addClass(baseSplashDialog.container, 'trellis-splash-root'); // NEW
		baseSplashDialog.container.trellisSplashDialog = baseSplashDialog; // NEW
		removeLanguageControl(baseSplashDialog.container); // NEW
		createHelpFooter(editorUi, baseSplashDialog.container); // NEW
		decorateRenderedState(baseSplashDialog); // NEW
		baseSplashDialog.container.addEventListener('click', function() { // NEW
			decorateRenderedState(baseSplashDialog); // NEW
		}); // NEW
		return baseSplashDialog; // NEW
	} // NEW

	function isSafeBackgroundFilename(filename) { // NEW
		return typeof filename == 'string' && filename.length > 0 && // NEW
			filename == filename.replace(/^.*[\\\\\/]/, '') && /\.(webp|jpe?g|png)$/i.test(filename); // NEW
	} // NEW

	function applyBackgroundFilename(backdrop, filename) { // NEW
		if (!isSafeBackgroundFilename(filename) || window.Image == null) return; // NEW

		var backgroundUrl = IMAGE_PATH + '/trellis-splash/' + encodeURIComponent(filename); // NEW
		var image = new window.Image(); // NEW
		image.decoding = 'async'; // NEW
		image.onload = function() { // NEW
			backdrop.style.setProperty('--trellis-splash-image', 'url("' + backgroundUrl + '")'); // NEW
			addClass(backdrop, 'trellis-splash-has-image'); // NEW
		}; // NEW
		image.onerror = function() { // NEW
			backdrop.style.removeProperty('--trellis-splash-image'); // NEW
		}; // NEW
		image.src = backgroundUrl; // NEW
	} // NEW

	function requestBackground(backdrop) { // NEW
		if (typeof electron == 'undefined' || electron.request == null) return; // NEW

		electron.request({ action: 'getTrellisSplashBackground' }, function(filename) { // NEW
			applyBackgroundFilename(backdrop, filename); // NEW
		}, function() { // NEW
			backdrop.style.removeProperty('--trellis-splash-image'); // NEW
		}); // NEW
	} // NEW

	function getWorkspaceBounds(editorUi) { // NEW
		var workspace = editorUi.diagramContainer; // NEW
		var bounds = workspace != null && workspace.getBoundingClientRect != null ? // NEW
			workspace.getBoundingClientRect() : null; // NEW
		var documentElement = document.documentElement; // NEW
		var viewportWidth = documentElement != null && documentElement.clientWidth > 0 ? // NEW
			documentElement.clientWidth : (window.innerWidth || 0); // NEW
		var viewportHeight = documentElement != null && documentElement.clientHeight > 0 ? // NEW
			documentElement.clientHeight : (window.innerHeight || 0); // NEW
		var left = bounds != null && isFinite(bounds.left) ? Math.max(0, bounds.left) : 0; // NEW
		var top = bounds != null && isFinite(bounds.top) ? Math.max(0, bounds.top) : 0; // NEW
		var width = bounds != null && isFinite(bounds.width) && bounds.width > 0 ? // NEW
			bounds.width : Math.max(0, viewportWidth - left); // NEW
		var height = bounds != null && isFinite(bounds.height) && bounds.height > 0 ? // NEW
			bounds.height : Math.max(0, viewportHeight - top); // NEW

		return { left: left, top: top, width: width, height: height }; // NEW
	} // NEW

	function applyWorkspaceLayout(editorUi, outerDialog) { // NEW
		var bounds = getWorkspaceBounds(editorUi); // NEW
		var compact = bounds.width < centeredDialogWidth + centeredDialogMargin * 2 || // NEW
			bounds.height < centeredDialogHeight + centeredDialogMargin * 2; // NEW
		var targets = [outerDialog.container, outerDialog.bg]; // NEW

		for (var i = 0; i < targets.length; i++) { // NEW
			if (targets[i] == null) continue; // NEW
			targets[i].style.setProperty('--trellis-workspace-left', bounds.left + 'px'); // NEW
			targets[i].style.setProperty('--trellis-workspace-top', bounds.top + 'px'); // NEW
			targets[i].style.setProperty('--trellis-workspace-width', bounds.width + 'px'); // NEW
			targets[i].style.setProperty('--trellis-workspace-height', bounds.height + 'px'); // NEW
			targets[i].style.setProperty('--trellis-workspace-center-x', (bounds.left + bounds.width / 2) + 'px'); // NEW
			targets[i].style.setProperty('--trellis-workspace-center-y', (bounds.top + bounds.height / 2) + 'px'); // NEW
		} // NEW

		if (compact) addClass(outerDialog.container, 'trellis-splash-compact'); // NEW
		else removeClass(outerDialog.container, 'trellis-splash-compact'); // NEW
	} // NEW

	function decorateOuterDialog(editorUi, splashDialog, outerDialog) { // NEW
		addClass(outerDialog.container, 'trellis-splash-dialog'); // NEW
		addClass(outerDialog.bg, 'trellis-splash-backdrop'); // NEW
		applyWorkspaceLayout(editorUi, outerDialog); // NEW
		splashDialog.trellisOuterDialog = outerDialog; // NEW
		updateCloseLabel(splashDialog, outerDialog); // NEW
		requestBackground(outerDialog.bg); // NEW

		if (outerDialog.trellisSplashCleanup != null) outerDialog.trellisSplashCleanup(); // NEW
		var disposed = false; // NEW
		var resizeHandler = function() { applyWorkspaceLayout(editorUi, outerDialog); }; // NEW
		var cleanup = function() { // NEW
			if (disposed) return; // NEW
			disposed = true; // NEW
			window.removeEventListener('resize', resizeHandler); // NEW
			outerDialog.trellisSplashCleanup = null; // NEW
		}; // NEW
		window.addEventListener('resize', resizeHandler); // NEW
		outerDialog.trellisSplashCleanup = cleanup; // NEW

		if (typeof outerDialog.close == 'function' && !outerDialog.trellisSplashCloseWrapped) { // NEW
			var baseClose = outerDialog.close; // NEW
			outerDialog.close = function() { // CHANGE
				if (typeof this.trellisSplashCleanup == 'function') this.trellisSplashCleanup(); // NEW
				return baseClose.apply(this, arguments); // NEW
			}; // CHANGE
			outerDialog.trellisSplashCloseWrapped = true; // NEW
		} // NEW
	} // NEW

	function install() { // NEW
		if (installed || typeof SplashDialog == 'undefined') return; // NEW
		installed = true; // NEW

		var BaseSplashDialog = SplashDialog; // NEW
		SplashDialog = function(editorUi) { // CHANGE
			return enhanceSplashDialog(new BaseSplashDialog(editorUi), editorUi); // NEW
		}; // CHANGE

		if (typeof App != 'undefined' && App.prototype != null && App.prototype.showDialog != null) { // NEW
			var baseShowDialog = App.prototype.showDialog; // NEW
			App.prototype.showDialog = function(element) { // CHANGE
				var result = baseShowDialog.apply(this, arguments); // NEW

				if (element != null && element.trellisSplashDialog != null && this.dialog != null) { // NEW
					decorateOuterDialog(this, element.trellisSplashDialog, this.dialog); // NEW
				} // NEW

				return result; // NEW
			}; // CHANGE
		} // NEW
	} // NEW

	window.TrellisSplashEnhancements = { // NEW
		install: install, // NEW
		enhanceSplashDialog: enhanceSplashDialog, // NEW
		decorateOuterDialog: decorateOuterDialog, // NEW
		isSafeBackgroundFilename: isSafeBackgroundFilename // NEW
	}; // NEW
})(); // NEW

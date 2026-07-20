/**
 * Copyright (c) 2006-2017, JGraph Holdings Ltd
 * Copyright (c) 2006-2017, draw.io AG
 */
/**
 * Contains current settings.
 */
var mxSettings =
{
	/**
	 * Defines current version of settings.
	 */
	currentVersion: 18,

	defaultFormatWidth: (screen.width < 600) ? '0' : '240',

	trellisStartupDefaultsKey: '.trellisStartupDefaults.v1', // NEW
	trellisDefaultPluginIds: [ // NEW
		'trellisUpdatesLinks', // NEW
		'trellisDatabaseTools', // NEW
		'trellisUiCleanup', // NEW
		'trellisUsers', // NEW
		'trellisContextMenu', // NEW
		'gardenSuccession', // NEW
		'plantTiler', // NEW
		'gardenTasks', // NEW
		'gardenModules', // NEW
		'gardenParenting', // NEW
		'gardenScheduler', // NEW
		'gardenClickThrough', // NEW
		'gardenLinking', // NEW
		'tidyContextMenu', // NEW
		'createdChangeMap', // NEW
		'gardenDashboard', // NEW
		'gardenPlanner', // NEW
		'gardenScale', // NEW
		'gardenBeds', // NEW
		'gardenEquipment', // NEW
		'gardenIrrigationPlanner' // NEW
	], // NEW
	trellisDefaultPluginPaths: { // NEW
		trellisUpdatesLinks: 'plugins/garden_planner_plugins/Trellis_Updates_Links.js', // NEW
		trellisDatabaseTools: 'plugins/garden_planner_plugins/Trellis_Database_Tools.js', // NEW
		trellisUiCleanup: 'plugins/garden_planner_plugins/Trellis_UI_Cleanup.js', // NEW
		trellisUsers: 'plugins/garden_planner_plugins/Trellis_Users.js', // NEW
		trellisContextMenu: 'plugins/garden_planner_plugins/Trellis_Context_Menu.js', // NEW
		gardenSuccession: 'plugins/garden_planner_plugins/Bed_Succession_Navigator.js', // NEW
		plantTiler: 'plugins/garden_planner_plugins/Plant_Tiler.js', // NEW
		gardenTasks: 'plugins/garden_planner_plugins/Garden_Task_Manager.js', // NEW
		gardenModules: 'plugins/garden_planner_plugins/Modules_Standalone.js', // NEW
		gardenParenting: 'plugins/garden_planner_plugins/Planting_Group_Parenting_Controls.js', // NEW
		gardenScheduler: 'plugins/garden_planner_plugins/Garden_Scheduler_Dialog.js', // NEW
		gardenClickThrough: 'plugins/garden_planner_plugins/Deep_Click_Through.js', // NEW
		gardenLinking: 'plugins/garden_planner_plugins/Vertex_Linking_Standalone.js', // NEW
		tidyContextMenu: 'plugins/garden_planner_plugins/Tidy_Context_Menu.js', // NEW
		createdChangeMap: 'plugins/garden_planner_plugins/Created_Change_Map.js', // NEW
		gardenDashboard: 'plugins/garden_planner_plugins/Garden_Dashboard.js', // NEW
		gardenPlanner: 'plugins/garden_planner_plugins/Year_Planner.js', // NEW
		gardenScale: 'plugins/garden_planner_plugins/Garden_Scale.js', // NEW
		gardenBeds: 'plugins/garden_planner_plugins/Garden_Beds.js', // NEW
		gardenEquipment: 'plugins/garden_planner_plugins/Garden_Equipment.js', // NEW
		gardenIrrigationPlanner: 'plugins/garden_planner_plugins/Garden_Irrigation_Planner.js' // NEW
	}, // NEW

	// NOTE: Hardcoded in index.html due to timing of JS loading
	key: Editor.settingsKey,

	getLanguage: function()
	{
		return mxSettings.settings.language;
	},
	setLanguage: function(lang)
	{
		mxSettings.settings.language = lang;
	},
	isMainSettings: function()
	{
		return mxSettings.key == '.drawio-config';
	},
	getMainSettings: function()
	{
		var value = localStorage.getItem('.drawio-config');

		if (value == null)
		{
			value = mxSettings.getDefaults();
			delete value.isNew;
		}
		else
		{
			value = JSON.parse(value);
			value.version = mxSettings.currentVersion;
		}

		return value;
	},
	getUi: function()
	{
		return (mxSettings.isMainSettings()) ? mxSettings.settings.ui :
			mxSettings.getMainSettings().ui;
	},
	setUi: function(ui)
	{
		if (mxSettings.isMainSettings())
		{
			mxSettings.settings.ui = ui;
			mxSettings.save();
		}
		else
		{
			var value = mxSettings.getMainSettings();
			value.ui = ui;
			localStorage.setItem('.drawio-config', JSON.stringify(value));
		}
	},
	getShowStartScreen: function()
	{
		return mxSettings.settings.showStartScreen;
	},
	setShowStartScreen: function(showStartScreen)
	{
		mxSettings.settings.showStartScreen = showStartScreen;
	},
	getGridColor: function(darkMode)
	{
		var result = (darkMode) ? mxSettings.settings.darkGridColor :
			mxSettings.settings.gridColor;

		if (mxUtils.isLightDarkColor(result))
		{
			var ld = mxUtils.getLightDarkColor(result);
			result = (darkMode) ? ld.dark : ld.light;
		}

		return result;
	},
	setGridColor: function(gridColor, darkMode)
	{
		if (darkMode)
		{
			mxSettings.settings.darkGridColor = gridColor;
		}
		else
		{
			mxSettings.settings.gridColor = gridColor;
		}
	},
	getAutosave: function()
	{
		return mxSettings.settings.autosave;
	},
	setAutosave: function(autosave)
	{
		mxSettings.settings.autosave = autosave;
	},
	getResizeImages: function()
	{
		return mxSettings.settings.resizeImages;
	},
	setResizeImages: function(resizeImages)
	{
		mxSettings.settings.resizeImages = resizeImages;
	},
	getOpenCounter: function()
	{
		return mxSettings.settings.openCounter;
	},
	setOpenCounter: function(openCounter)
	{
		mxSettings.settings.openCounter = openCounter;
	},
	setCustomFonts: function(fonts)
	{
		mxSettings.settings.customFonts = fonts;
	},
	getCustomFonts: function()
	{
		//Convert from old format to the new one
		var custFonts = mxSettings.settings.customFonts || [];

		for (var i = 0 ; i < custFonts.length; i++)
		{
			if (typeof custFonts[i] === 'string')
			{
				custFonts[i] = {name: custFonts[i], url: null};
			}
		}

		return custFonts;
	},
	getLibraries: function()
	{
		return mxSettings.settings.libraries;
	},
	setLibraries: function(libs)
	{
		mxSettings.settings.libraries = libs;
	},
	addCustomLibrary: function(id)
	{
		// Makes sure to update the latest data from the localStorage
		mxSettings.load();

		//If the setting is incorrect, reset it to an empty array
		if (!Array.isArray(mxSettings.settings.customLibraries))
		{
			mxSettings.settings.customLibraries = [];
		}

		if (mxUtils.indexOf(mxSettings.settings.customLibraries, id) < 0)
		{
			// Makes sure scratchpad is below search in sidebar
			if (id === 'L.scratchpad')
			{
				mxSettings.settings.customLibraries.splice(0, 0, id);
			}
			else
			{
				mxSettings.settings.customLibraries.push(id);
			}
		}

		mxSettings.save();
	},
	removeCustomLibrary: function(id)
	{
		// Makes sure to update the latest data from the localStorage
		mxSettings.load();
		mxUtils.remove(id, mxSettings.settings.customLibraries);
		mxSettings.save();
	},
	getCustomLibraries: function()
	{
		return mxSettings.settings.customLibraries;
	},
	getPlugins: function()
	{
		return mxSettings.settings.plugins;
	},
	setPlugins: function(plugins)
	{
		mxSettings.settings.plugins = plugins;
	},
	getTrellisDefaultPluginIds: function() // NEW
	{
		return mxSettings.trellisDefaultPluginIds.slice(); // NEW
	}, // NEW
	getTrellisDefaultPluginPaths: function() // NEW
	{
		var result = []; // NEW

		for (var i = 0; i < mxSettings.trellisDefaultPluginIds.length; i++) // NEW
		{
			result.push(mxSettings.trellisDefaultPluginPaths[mxSettings.trellisDefaultPluginIds[i]]); // NEW
		}

		return result; // NEW
	}, // NEW
	applyTrellisStartupDefaults: function() // NEW
	{
		var changed = false; // NEW

		if (!Array.isArray(mxSettings.settings.plugins) || mxSettings.settings.plugins.length == 0) // NEW
		{
			mxSettings.settings.plugins = mxSettings.getTrellisDefaultPluginPaths(); // NEW
			changed = true; // NEW
		}

		if (mxSettings.settings.showStartScreen == null) // NEW
		{
			mxSettings.settings.showStartScreen = true; // NEW
			changed = true; // NEW
		}

		if (mxSettings.settings.autosave == null) // NEW
		{
			mxSettings.settings.autosave = true; // NEW
			changed = true; // NEW
		}
		else if (EditorUi.isElectronApp && isLocalStorage && // NEW
			localStorage.getItem('._autoSaveTrans_') != null && // NEW
			localStorage.getItem(mxSettings.trellisStartupDefaultsKey) == null && // NEW
			mxSettings.settings.autosave === false) // NEW
		{
			localStorage.setItem(mxSettings.trellisStartupDefaultsKey, '1'); // NEW
			mxSettings.settings.autosave = true; // NEW
			changed = true; // NEW
		}

		return changed; // NEW
	}, // NEW
	getRecentColors: function()
	{
		return mxSettings.settings.recentColors;
	},
	setRecentColors: function(recentColors)
	{
		mxSettings.settings.recentColors = recentColors;
	},
	getFormatWidth: function()
	{
		return parseInt(mxSettings.settings.formatWidth);
	},
	setFormatWidth: function(formatWidth)
	{
		mxSettings.settings.formatWidth = formatWidth;
	},
	isCreateTarget: function()
	{
		return mxSettings.settings.createTarget;
	},
	setCreateTarget: function(value)
	{
		mxSettings.settings.createTarget = value;
	},
	getPageFormat: function()
	{
		return mxSettings.settings.pageFormat;
	},
	setPageFormat: function(value)
	{
		mxSettings.settings.pageFormat = value;
	},
	getUnit: function()
	{
		return mxSettings.settings.unit || mxConstants.POINTS;
	},
	setUnit: function(value)
	{
		mxSettings.settings.unit = value;
	},
	isRulerOn: function()
	{
		return mxSettings.settings.isRulerOn;
	},
	setRulerOn: function(value)
	{
		mxSettings.settings.isRulerOn = value;
	},
	getDraftSaveDelay: function()
	{
		return mxSettings.settings.draftSaveDelay;
	},
	setDraftSaveDelay: function(value)
	{
		mxSettings.settings.draftSaveDelay = value;
	},
	getDefaults: function()
	{
		return {
			language: '',
			configVersion: Editor.configVersion,
			customFonts: [],
			libraries: Sidebar.prototype.defaultEntries,
			customLibraries: Editor.defaultCustomLibraries,
			plugins: mxSettings.getTrellisDefaultPluginPaths(), // CHANGE
			recentColors: [],
			formatWidth: mxSettings.defaultFormatWidth,
			createTarget: urlParams['sketch'] == '1',
			pageFormat: mxGraph.prototype.pageFormat,
			search: true,
			showStartScreen: true, // CHANGE
			gridColor: mxGraphView.prototype.defaultGridColor,
			darkGridColor: mxGraphView.prototype.defaultDarkGridColor,
			darkMode: 'auto',
			autosave: true, // CHANGE
			resizeImages: null,
			openCounter: 0,
			version: mxSettings.currentVersion,
			// Only defined and true for new settings which haven't been saved
			isNew: true,
			unit: mxConstants.POINTS,
			isRulerOn: false
		};
	},
	init: function()
	{
		mxSettings.settings = mxSettings.getDefaults();
	},
	save: function()
	{
		if (isLocalStorage && typeof(JSON) !== 'undefined')
		{
			try
			{
				delete mxSettings.settings.isNew;
				mxSettings.settings.version = mxSettings.currentVersion;
				localStorage.setItem(mxSettings.key, JSON.stringify(mxSettings.settings));
			}
			catch (e)
			{
				// ignores quota exceeded
			}
		}
	},
	load: function()
	{
		try
		{
			if (isLocalStorage && typeof(JSON) !== 'undefined')
			{
				mxSettings.parse(localStorage.getItem(mxSettings.key));
			}
		}
		catch (e)
		{
			if (window.console != null)
			{
				console.log('Error loading settings:', mxSettings.key, e);
			}
		}

		if (mxSettings.settings == null)
		{
			mxSettings.init();
		}
	},
	parse: function(value)
	{
		var config = (value != null) ? JSON.parse(value) : null;

		if (config == null || (config.configVersion != Editor.configVersion) ||
			(Editor.config != null && Editor.config.override))
		{
			mxSettings.settings = null;
			mxSettings.init();
		}
		else
		{
			mxSettings.settings = config;

			if (mxSettings.settings.plugins == null)
			{
				mxSettings.settings.plugins = []; // CHANGE
			}

			if (mxSettings.settings.recentColors == null)
			{
				mxSettings.settings.recentColors = [];
			}

			if (mxSettings.settings.customFonts == null)
			{
				mxSettings.settings.customFonts = [];
			}

			if (mxSettings.settings.libraries == null)
			{
				mxSettings.settings.libraries = Sidebar.prototype.defaultEntries;
			}

			if (mxSettings.settings.customLibraries == null)
			{
				mxSettings.settings.customLibraries = Editor.defaultCustomLibraries;
			}

			if (mxSettings.settings.ui == null)
			{
				mxSettings.settings.ui = '';
			}

			if (mxSettings.settings.formatWidth == null)
			{
				mxSettings.settings.formatWidth = mxSettings.defaultFormatWidth;
			}

			if (mxSettings.settings.lastAlert != null)
			{
				delete mxSettings.settings.lastAlert;
			}

			if (mxSettings.settings.createTarget == null)
			{
				mxSettings.settings.createTarget = false;
			}

			if (mxSettings.settings.pageFormat == null)
			{
				mxSettings.settings.pageFormat = mxGraph.prototype.pageFormat;
			}

			if (mxSettings.settings.search == null)
			{
				mxSettings.settings.search = true;
			}

			if (mxSettings.settings.showStartScreen == null)
			{
				mxSettings.settings.showStartScreen = true; // CHANGE
			}

			if (mxSettings.settings.gridColor == null)
			{
				mxSettings.settings.gridColor = mxGraphView.prototype.defaultGridColor;
			}

			if (mxSettings.settings.darkGridColor == null)
			{
				mxSettings.settings.darkGridColor = mxGraphView.prototype.defaultDarkGridColor;
			}

			if (mxSettings.settings.autosave == null)
			{
				mxSettings.settings.autosave = true; // CHANGE
			}

			if (mxSettings.settings.scratchpadSeen != null)
			{
				delete mxSettings.settings.scratchpadSeen;
			}

			if (mxSettings.applyTrellisStartupDefaults()) // NEW
			{
				mxSettings.save(); // NEW
			}
		}
	},
	clear: function()
	{
		if (isLocalStorage)
		{
			localStorage.removeItem(mxSettings.key);
		}
	}
}

/**
 * Variable: mxLoadSettings
 *
 * Optional global config variable to toggle loading the settings. Default is true.
 *
 * (code)
 * <script type="text/javascript">
 * 		var mxLoadSettings = false;
 * </script>
 * (end)
 */
if (typeof(mxLoadSettings) == 'undefined' || mxLoadSettings)
{
	// Loads initial content
	mxSettings.load();
}

/** Authoritative displayed/spoken English instructions and complete narration variants. */ // NEW
(function createCatalog(root, data) { // NEW
    'use strict'; // NEW
    /** Return exact authored text, including intentional suffix spacing. */ // NEW
    function text(id) { // NEW
        if (!Object.prototype.hasOwnProperty.call(data.messages, id)) throw new Error('Unknown narration: ' + id); // NEW
        return data.messages[id]; // NEW
    } // NEW
    /** Generate complete utterances, preserving natural transitions and prosody. */ // NEW
    function entries() { // NEW
        const all = Object.values(data.messages).filter(value => !value.startsWith(' ')); // NEW
        for (const id of data.fieldIds) for (const suffix of data.fieldSuffixes) all.push(text(id) + text(suffix)); // NEW
        for (const id of data.canvasIds) for (const suffix of data.canvasSuffixes) all.push(text(id) + text(suffix)); // NEW
        for (const id of data.planIds) all.push(text(id) + text(data.planReveal)); // NEW
        const missing = text(data.demandValues) + text(data.missingDemand); // NEW
        all.push(missing, missing + text(data.planReveal)); // NEW
        return [...new Set(all)]; // NEW
    } // NEW
    const api = Object.freeze({ text, entries }); // NEW
    if (typeof module !== 'undefined' && module.exports) module.exports = api; // NEW
    else root.TrellisNarrationCatalog = api; // NEW
})(typeof window !== "undefined" ? window : globalThis, { // NEW
    "messages": { // NEW
        "chooseTheGardenYouWantToUse": "Choose the garden you want to use in the Garden selector above.", // NEW
        "createAGardenFirstUseTheHighlighted": "Create a garden first. Use the highlighted Create Garden control, or open Garden Projects to create a project.", // NEW
        "selectYourGardenToShowItsLayout": "Select your garden to show its layout controls.", // NEW
        "finishGardenSettingsFirstThenReturnTo": "Finish Garden Settings first, then return to this step.", // NEW
        "expandThisGardenModuleToRevealIts": "Expand this garden module to reveal its layout and controls, then select it again.", // NEW
        "closeTheActiveModeToShowThe": "Close the active mode to show the garden layout controls.", // NEW
        "thisDiagramIsReadOnlyAskIts": "This diagram is read only. Ask its owner for editing access, or switch to the invitee orientation.", // NEW
        "youDoNotHavePermissionToEdit": "You do not have permission to edit this garden. Use the invitee guide or ask the owner for access.", // NEW
        "settings-source": "Choose local defaults or a garden template, if this is a new garden.", // NEW
        "settings-city": "Choose its city so scheduling uses the right climate.", // NEW
        "settings-units": "Choose the units you use.", // NEW
        "settings-bed-width": "Choose the default bed width.", // NEW
        "settings-bed-length": "Choose the default bed length.", // NEW
        "settings-save": "Save Garden Settings. Any validation issues must be resolved before this step completes.", // NEW
        "allocation-week": "Choose an actionable sow/start week.", // NEW
        "allocation-crop": "Choose the crop to allocate.", // NEW
        "allocation-bed": "Select a bed in the garden, or use Find best bed.", // NEW
        "allocation-defaults": "Resolve any missing required defaults using these links.", // NEW
        "allocation-preview": "Inspect the proposed planting and any warnings.", // NEW
        "allocation-create": "Choose Create planting when the existing validation enables it.", // NEW
        "irrigation-source": "Create or select one water source.", // NEW
        "irrigation-bed": "Select a garden bed and configure its irrigation assembly.", // NEW
        "irrigation-connect": "Select compatible source and bed ports to connect them using the existing connection controls.", // NEW
        "irrigation-analysis": "Open analysis to inspect the connection. This example does not validate the entire garden irrigation design.", // NEW
        "confirmThePlanningYearThenUseAdd": "Confirm the planning year, then use Add/Remove crops to choose what to grow and Apply changes. Keep the year aligned with this guide.", // NEW
        "forTheSelectedCropChooseAVariety": "For the selected crop, choose a variety or keep the base plant, then choose the planting method. You can keep suitable existing values.", // NEW
        "chooseTheSelectedCropSHarvestWindow": "Choose the selected crop’s harvest window source. For Manual dates, enter a feasible harvest start and end; other sources provide their own dates.", // NEW
        "openSalesDemandAddASalesChannel": "Open Sales demand. Add a sales channel if needed, name it and choose its type, then use Manage packages and Apply changes to add demand for your crop.", // NEW
        "openSelfSufficiencyThenUseManagePackages": "Open Self Sufficiency, then use Manage packages and Apply changes to add demand for your crop. Enable self-use if it is disabled.", // NEW
        "forTheSelectedCropSDemandLine": "For the selected crop’s demand line, choose the crop, a positive quantity, unit, frequency, and first and last demand dates. Existing values may be kept if they suit your plan.", // NEW
        "addAMatchingDemandLineInDemand": " Add a matching demand line in Demand setup first.", // NEW
        "reviewPlanCheckReadTheWarningsAnd": "Review Plan Check. Read the warnings and resolve blocking issues before saving. Calculated results help you assess the plan; they are not editable inputs.", // NEW
        "saveThePlanWhenPlanCheckAllows": "Save the plan when Plan Check allows it. A committed plan with positive demand completes this milestone. Saving a draft keeps your work but does not complete it.", // NEW
        "useShowFieldsToRevealThisGroup": " Use Show fields to reveal this group, or finish the displayed prerequisites.", // NEW
        "theControlIsNotVisibleYetComplete": " The control is not visible yet. Complete the previous action or expand the relevant section, then use Retry.", // NEW
        "thisControlIsDisabledResolveTheWorkflow": " This control is disabled. Resolve the workflow’s displayed prerequisites, then retry; the guide will not bypass them.", // NEW
        "thisWorkflowIsForAnotherGardenOr": "This workflow is for another garden or year. Close it to continue here, or explicitly use its context.", // NEW
        "settings-name": "Name this garden.", // NEW
        "settings-width": "Enter the garden width.", // NEW
        "settings-length": "Enter its length.", // NEW
        "missingGarden": "A garden module has not been created yet. The owner can add one later; choose Next to continue.", // NEW
        "missingYearPlan": "A year plan has not been created yet. Its owner can add one later. Choose Next to continue.", // NEW
        "finishOrCloseTheOpenWorkflowBefore": "Finish or close the open workflow before continuing this step, or switch to its guidance.", // NEW
        "chooseOneAvailableCropPackageUsingIts": "Choose one available crop package using its Add control, then Apply changes to return to the demand fields.", // NEW
        "selectTheCropYouWantToGrow": "Select the crop you want to grow, then Apply changes to return to the year plan.", // NEW
        "createAPrivateGardenProjectUsingThe": "Create a private garden project using the highlighted control. Give it a name and submit; the existing project workflow will open its starter garden.", // NEW
        "openTheInvitedProjectFromSharedGarden": "Open the invited project from Shared garden projects, or finish the access request if approval is pending. Then return to its diagram for orientation.", // NEW
        "chooseAddGardenInAnExistingCommunity": "Choose Add garden in an existing community or Create Garden Community. Select this project in the form and submit. Approval may remain pending.", // NEW
        "joinSharedCanvasUsingYourInvitationFinish": "Join Shared Canvas using your invitation, finish its approval/access steps, and open the project. If it is already open with access, this step is complete.", // NEW
        "selectYourGardenModuleToRevealIts": "Select your garden module to reveal its layout controls and locate its beds.", // NEW
        "usePlanYearOrTheGardenDashboard": "Use Plan Year or the garden dashboard to inspect the existing year plan. You do not need to edit it.", // NEW
        "locateTheAllocatedPlantingsInsideTheGarden": "Locate the allocated plantings inside the garden beds. You do not need to edit them.", // NEW
        "noAllocatedPlantingsArePresentForThis": "No allocated plantings are present for this year yet. Choose Next to finish the orientation.", // NEW
        "finishOrCloseTheOpenDialogThen": "Finish or close the open dialog, then choose Retry to reveal this step’s controls.", // NEW
        "openGardenSettingsToConfigureThisGarden": "Open Garden Settings to configure this garden.", // NEW
        "chooseAddGardenBedTheBedUses": "Choose Add Garden Bed. The bed uses your saved default dimensions; position it inside the garden.", // NEW
        "openIrrigationToConnectOneBedYou": "Open Irrigation to connect one bed. You may skip irrigation for now.", // NEW
        "openPlanYearToCreateASmall": "Open Plan Year to create a small sales plan.", // NEW
        "openPlanYearToCreateASmall2": "Open Plan Year to create a small self-use plan.", // NEW
        "openAllocateAfterSavingTheYearPlan": "Open Allocate after saving the year plan, then create one planting.", // NEW
        "chooseShareToInviteAUserOr": "Choose Share to invite a user, or Canvas Sync to add another computer. Finish preparing an invitation; approval can happen later.", // NEW
        "openGardenProjectsThenChooseAnExisting": "Open Garden Projects, then choose an existing community or create one with this project.", // NEW
        "saveAYearPlanWithPositiveDemand": "Save a year plan with positive demand before allocating. Finish the planning step first.", // NEW
        "ifTheControlIsHiddenSelectThe": " If the control is hidden, select the garden module again. Close another open dialog or mode, then retry.", // NEW
        "thisControlIsDisabledCheckItsTooltip": " This control is disabled. Check its tooltip and finish the displayed prerequisites.", // NEW
        "reopenTheCurrentWorkflowThenChooseRetry": "Reopen the current workflow, then choose Retry to continue.", // NEW
        "oath": "I solemnly affirm, with unnecessary ceremony and full awareness that this button did not appear by accident, that I have answered the Trellis license questions honestly, that I understand commercial use requires contacting the project owner, and that I will not pretend I missed this because the software was too polite." // NEW
    }, // NEW
    "fieldIds": [ // NEW
        "settings-name", // NEW
        "settings-width", // NEW
        "settings-length", // NEW
        "settings-source", // NEW
        "settings-city", // NEW
        "settings-units", // NEW
        "settings-bed-width", // NEW
        "settings-bed-length", // NEW
        "settings-save", // NEW
        "allocation-week", // NEW
        "allocation-crop", // NEW
        "allocation-bed", // NEW
        "allocation-defaults", // NEW
        "allocation-preview", // NEW
        "allocation-create", // NEW
        "irrigation-source", // NEW
        "irrigation-bed", // NEW
        "irrigation-connect", // NEW
        "irrigation-analysis" // NEW
    ], // NEW
    "canvasIds": [ // NEW
        "openGardenSettingsToConfigureThisGarden", // NEW
        "chooseAddGardenBedTheBedUses", // NEW
        "openIrrigationToConnectOneBedYou", // NEW
        "openPlanYearToCreateASmall", // NEW
        "openPlanYearToCreateASmall2", // NEW
        "openAllocateAfterSavingTheYearPlan", // NEW
        "chooseShareToInviteAUserOr", // NEW
        "openGardenProjectsThenChooseAnExisting" // NEW
    ], // NEW
    "planIds": [ // NEW
        "confirmThePlanningYearThenUseAdd", // NEW
        "forTheSelectedCropChooseAVariety", // NEW
        "chooseTheSelectedCropSHarvestWindow", // NEW
        "openSalesDemandAddASalesChannel", // NEW
        "openSelfSufficiencyThenUseManagePackages", // NEW
        "forTheSelectedCropSDemandLine", // NEW
        "reviewPlanCheckReadTheWarningsAnd", // NEW
        "saveThePlanWhenPlanCheckAllows" // NEW
    ], // NEW
    "fieldSuffixes": [ // NEW
        "theControlIsNotVisibleYetComplete", // NEW
        "thisControlIsDisabledResolveTheWorkflow" // NEW
    ], // NEW
    "canvasSuffixes": [ // NEW
        "ifTheControlIsHiddenSelectThe", // NEW
        "thisControlIsDisabledCheckItsTooltip" // NEW
    ], // NEW
    "planReveal": "useShowFieldsToRevealThisGroup", // NEW
    "missingDemand": "addAMatchingDemandLineInDemand", // NEW
    "demandValues": "forTheSelectedCropSDemandLine" // NEW
}); // NEW

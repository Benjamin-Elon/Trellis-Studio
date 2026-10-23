window.makeFixture=count=>{ // NEW
    if (!window.clusterRoleTemplate) { // NEW: clone the real eleven-field production role template rather than substituting an empty rectangle.
        const temporary = graph.insertVertex(null, null, value({team_module:1}), 0, 0, 600, 400, 'swimlane;module=1;'); // NEW
        const role = graph.__trellisModules.createRoleCard(temporary, 10, 30); // NEW
        window.clusterRoleTemplate = graph.model.cloneCells([role], true)[0]; graph.model.remove(temporary); // NEW
    } // NEW
    if (graph.__trellisTaskManager && !window.clusterTaskTemplate) { // NEW
        const module=graph.insertVertex(null,null,value({task_module:1,trellis_owner_user_id:window.Trellis?.users?.getCurrentUser?.()?.id||''}),-100000,-100000,600,400,'swimlane;module=1;module_margin=0;'); // NEW
        const created=graph.__trellisTaskManager.ensureMainBoardInTaskModule(module); // NEW
        window.clusterTaskTemplate=graph.model.cloneCells([created.board||created],true)[0];graph.model.remove(module); // NEW
    } // NEW
    if (graph.__trellisRoadmapManager && !window.clusterRoadmapTemplate) { // NEW
        const module=graph.insertVertex(null,null,value({roadmap_module:1,roadmap_type:'module',trellis_owner_user_id:window.Trellis?.users?.getCurrentUser?.()?.id||''}),-200000,-100000,600,400,'swimlane;module=1;module_margin=0;'); // NEW
        const board=graph.__trellisRoadmapManager.ensureMainRoadmapInRoadmapModule(module); // NEW
        window.clusterRoadmapTemplate=graph.model.cloneCells([board],true)[0];graph.model.remove(module); // NEW
    } // NEW
    const root=new mxCell(),layer=new mxCell();root.insert(layer); // NEW
    if(window.clusterLayerMetadata)layer.value=clusterLayerMetadata.cloneNode(true); // NEW: preserve the private production user's diagram metadata during fixture replacement.
    if(window.clusterRootMetadata)root.value=clusterRootMetadata.cloneNode(true); // NEW
    for(let i=0;i<count;i++){ // NEW
        const city=i%5; // NEW
        function module(suffix,dx,attributes){ // NEW
            const cell=new mxCell(value({label:'Garden '+String(i).padStart(5,'0')+suffix,trellis_owner_user_id:window.Trellis?.users?.getCurrentUser?.()?.id||'',...attributes}),new mxGeometry((i%50)*40000+dx*25,Math.floor(i/50)*8000,180,120),'swimlane;module=1;module_margin=0;html=1;'); // NEW: separate full workspaces so layout repair is not benchmarking intentionally overlapping modules.
            cell.id='g'+i+suffix;cell.vertex=true;cell.collapsed=true;layer.insert(cell);return cell; // NEW
        } // NEW
        function content(parent,suffix,attributes){const cell=new mxCell(value({label:suffix,...attributes}),new mxGeometry(10+(parent.children?.length||0)%5*35,35+Math.floor((parent.children?.length||0)/5)*30,30,20),'html=1;');cell.id=parent.id+suffix;cell.vertex=true;parent.insert(cell);return cell;} // NEW
        const garden=module('',0,{garden_module:1,city_id:String(city),city_name:'City '+city,trellis_team_module_id:'g'+i+'-team',trellis_task_module_id:'g'+i+'-task',roadmap_module_id:'g'+i+'-roadmap'}); // NEW
        const team=module('-team',220,{team_module:1,trellis_garden_module_id:garden.id}); // NEW
        const task=module('-task',440,{task_module:1,trellis_garden_module_id:garden.id}); // NEW
        const roadmap=module('-roadmap',660,{roadmap_module:1,roadmap_type:'module',roadmap_garden_module_id:garden.id}); // NEW
        for(let j=0;j<5;j++)content(garden,'-bed'+j,{garden_bed:1}); // NEW
        for(let j=0;j<20;j++){const group=content(garden,'-planting'+j,{tiler_group:1,lod_collapsed:1,plant_count:100});content(group,'-summary',{lod_summary:1,label:'× 100'});} // NEW
        const board=window.clusterTaskTemplate?graph.model.cloneCells([clusterTaskTemplate],true)[0]:content(task,'-board',{board_key:'KANBAN_BOARD',board_role:'main'}); // NEW
        if(window.clusterTaskTemplate){board.id=task.id+'-board';task.insert(board);} // NEW
        const lane=(board.children||[]).find(cell=>cell.getAttribute?.('lane_key')==='TODO')||content(board,'-lane',{kanban_lane:1,lane_key:'TODO'}); // NEW
        for(let j=0;j<20;j++)content(lane,'-task'+j,{kanban_card:1,title:'Task '+j,workflow_state:'TODO'}); // NEW
        for(let j=0;j<3;j++){const role=graph.model.cloneCells([clusterRoleTemplate],true)[0];role.id=team.id+'-role'+j;team.insert(role);} // NEW
        if(window.clusterRoadmapTemplate){const board=graph.model.cloneCells([clusterRoadmapTemplate],true)[0];board.id=roadmap.id+'-main';roadmap.insert(board);}else content(roadmap,'-main',{roadmap_type:'board',roadmap_role:'main',roadmap_name:'Main Roadmap',roadmap_schema:'1'}); // NEW
    } // NEW
    return root; // NEW
}; // NEW
window.percentile=values=>values.slice().sort((a,b)=>a-b)[Math.ceil(values.length*.95)-1]; // NEW
window.benchmarkFixture=async(count,enabled,samples=25)=>{ // NEW
    if(window.smokeUi){window.clusterLayerMetadata=graph.getDefaultParent().value?.cloneNode?.(true)||null;window.clusterRootMetadata=graph.model.getRoot().value?.cloneNode?.(true)||null;} // NEW
    const emptyRoot=new mxGraphModel().getRoot();if(window.clusterLayerMetadata)emptyRoot.getChildAt(0).value=clusterLayerMetadata.cloneNode(true);if(window.smokeUi?.currentPage)smokeUi.currentPage.root=emptyRoot;graph.model.setRoot(emptyRoot);undo.clear();window.gc?.(); // NEW: a fresh file must not retain the previous fixture through undo history.
    let fixture=new mxGraphModel(makeFixture(count)),codec=new mxCodec();const xml=mxUtils.getXml(codec.encode(fixture)); // NEW
    fixture=null;codec=null;window.gc?.();console.log('CLUSTER_STAGE: serialized fixture '+xml.length); // NEW
    let start=performance.now();const document=mxUtils.parseXml(xml);const parseMs=performance.now()-start;const decoded=new mxCodec(document).decode(document.documentElement);const decodeMs=performance.now()-start-parseMs; // NEW
    if(window.smokeUi?.currentPage)smokeUi.currentPage.root=decoded.getRoot();graph.model.setRoot(decoded.getRoot());undo.clear();await frames();const openMs=performance.now()-start; // NEW
    console.log('CLUSTER_STAGE: decoded fixture '+openMs); // NEW
    const selection=[],edit=[],switches=[]; // NEW
    if(enabled)clusters.setCity('all'); // NEW
    for(let i=0;i<samples;i++){ // NEW
        const garden=graph.model.getCell('g'+(i*197%count)); // NEW
        if(!garden)throw Error('Fixture garden missing at '+i+'; root has '+Object.keys(graph.model.cells).length+' cells; first IDs '+Object.keys(graph.model.cells).slice(0,12).join(',')); // NEW
        start=performance.now();graph.setSelectionCell(garden);await frames();selection.push(performance.now()-start); // NEW
        start=performance.now();write(garden.children[0],{label:'Measured edit '+i});await frames();edit.push(performance.now()-start); // NEW
        start=performance.now();graph.foldCells(false,false,[garden,...['-team','-task','-roadmap'].map(suffix=>graph.model.getCell(garden.id+suffix))]);await frames();switches.push(performance.now()-start); // NEW
        if(i%5===0)console.log('CLUSTER_STAGE: interactions '+i); // NEW
    } // NEW
    const frameTimes=[];let last=performance.now(); // NEW
    for(let i=0;i<Math.min(30,samples);i++){graph.view.setTranslate((i%2)*5,(i%3)*5);graph.zoomTo(.8+(i%3)*.1);await new Promise(requestAnimationFrame);const now=performance.now();frameTimes.push(now-last);last=now;} // NEW
    start=performance.now();const saved=mxUtils.getXml(new mxCodec().encode(graph.model));const saveMs=performance.now()-start; // NEW
    return {count,enabled,samples,objects:Object.keys(graph.model.cells).length,xmlBytes:xml.length,parseMs,decodeMs,openMs,saveMs,selectionP95:percentile(selection),editP95:percentile(edit),switchP95:percentile(switches),panZoomFps:1000/(frameTimes.reduce((a,b)=>a+b,0)/frameTimes.length),states:graph.view.states.getValues().length,heapBytes:performance.memory?.usedJSHeapSize,savedBytes:saved.length,snapshot:enabled?clusters.snapshot():null}; // NEW
}; void 0; // NEW


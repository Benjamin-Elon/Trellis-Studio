Draw.loadPlugin(function (ui) {
    const graph = ui.editor.graph;
    const model = graph.getModel();

    // Override resizeChildCells so modules do not resize children
    const originalResizeChildCells = graph.resizeChildCells;

    graph.resizeChildCells = function (cell, newGeo) {
        if (cell && cell.style && cell.style.includes("module=1")) {
            return;
        }
        return originalResizeChildCells.apply(this, arguments);
    };

    // Safe style accessor
    function getStyle(cell) {
        return (cell && typeof cell.getStyle === "function")
            ? (cell.getStyle() || "")
            : (cell && cell.style ? cell.style : "") || "";
    }

    // ------------------------
    // MINIMAL MARGIN FEATURE
    // ------------------------

    // Parse integer style key with fallback
    function getIntStyle(cell, key, defVal) {
        const st = getStyle(cell);
        const m = st.match(new RegExp("(?:^|;)" + key + "=(\\d+)(?=;|$)"));
        return m ? parseInt(m[1], 10) : defVal;
    }

    // Is this a module?
    function isModule(cell) {
        return !!cell && getStyle(cell).includes("module=1");
    }

    // Get child union bounds relative to module (direct children only)
    function getChildUnionRelative(moduleCell) {
        const kids = model.getChildren(moduleCell) || [];
        let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
        let any = false;

        for (const k of kids) {
            if (!(k && k.isVertex && k.isVertex())) continue;
            const g = model.getGeometry(k);
            if (!g || g.relative) continue;

            const x = g.x || 0;
            const y = g.y || 0;
            const w = g.width || 0;
            const h = g.height || 0;

            left = Math.min(left, x);
            top = Math.min(top, y);
            right = Math.max(right, x + w);
            bottom = Math.max(bottom, y + h);
            any = true;
        }
        if (!any) return null;

        return { left, top, right, bottom, width: right - left, height: bottom - top };
    }

    // Is this a swimlane?                                                       
    function isSwimlane(cell) {
        return !!cell && /(?:^|;)swimlane(?:;|$)/.test(getStyle(cell));
    }

    // Get swimlane header size (startSize) safely                                
    function getStartSize(cell) {
        if (graph.getStartSize) {
            const sz = graph.getStartSize(cell) || {};
            return { width: sz.width || 0, height: sz.height || 0 };
        }
        const st = getStyle(cell) || "";
        const m = st.match(/(?:^|;)startSize=(\d+)(?=;|$)/);
        return { width: 0, height: m ? parseInt(m[1], 10) : 0 };
    }



    const MIN_W = 60, MIN_H = 40; // CHANGE
    const GARDEN_MIN_CONTENT_W = 440, GARDEN_MIN_CONTENT_H = 340; // CHANGE

    const EPS = 0.5; // epsilon                                                      

    function getModuleMinContentSize(moduleCell) { // CHANGE
        return isGardenModule(moduleCell) // CHANGE
            ? { width: GARDEN_MIN_CONTENT_W, height: GARDEN_MIN_CONTENT_H } // CHANGE
            : { width: MIN_W, height: MIN_H }; // CHANGE
    } // CHANGE

    function getModuleHeaderHeight(moduleCell) { // CHANGE
        return isSwimlane(moduleCell) ? getStartSize(moduleCell).height : 0; // CHANGE
    } // CHANGE

    function getModuleMinOuterSize(moduleCell) { // CHANGE
        const content = getModuleMinContentSize(moduleCell); // CHANGE
        return { width: content.width, height: content.height + getModuleHeaderHeight(moduleCell) }; // CHANGE
    } // CHANGE

    function enforceGardenModuleMinimum(moduleCell) { // CHANGE
        if (!isGardenModule(moduleCell)) return false; // CHANGE
        const g = model.getGeometry(moduleCell); // CHANGE
        if (!g) return false; // CHANGE
        const min = getModuleMinOuterSize(moduleCell); // CHANGE
        const nextW = Math.max(Number(g.width) || 0, min.width); // CHANGE
        const nextH = Math.max(Number(g.height) || 0, min.height); // CHANGE
        if (Math.abs(nextW - g.width) < EPS && Math.abs(nextH - g.height) < EPS) return false; // CHANGE
        const g2 = g.clone(); // CHANGE
        g2.width = nextW; // CHANGE
        g2.height = nextH; // CHANGE
        model.setGeometry(moduleCell, g2); // CHANGE
        return true; // CHANGE
    } // CHANGE

    function applyModuleMargins(moduleCell, opts) {
        const o = opts || {};
        const allowShrink = !!o.allowShrink;
        if (!isModule(moduleCell)) return;

        const margin = getIntStyle(moduleCell, "module_margin", 100);
        const mGeo = model.getGeometry(moduleCell);
        if (!mGeo) return;

        const u = getChildUnionRelative(moduleCell); // union in module space
        const minContent = getModuleMinContentSize(moduleCell); // CHANGE

        // Children coords are in swimlane content space; outerHeight = content + header.
        const headerH = getModuleHeaderHeight(moduleCell); // CHANGE

        const minRight = Math.max(u ? u.right + margin : 0, minContent.width); // CHANGE
        const minBottom = Math.max(u ? u.bottom + margin : 0, minContent.height); // CHANGE

        // If shrinking is allowed, snap to minima; otherwise never shrink (only expand).     
        const targetW = allowShrink ? minRight : Math.max(mGeo.width, minRight);
        const targetH = allowShrink ? (minBottom + headerH)
            : Math.max(mGeo.height, minBottom + headerH);

        if (Math.abs(targetW - mGeo.width) < EPS && Math.abs(targetH - mGeo.height) < EPS) {
            return;
        }

        model.beginUpdate();
        try {
            const g2 = mGeo.clone();
            g2.width = targetW;
            g2.height = targetH;
            model.setGeometry(moduleCell, g2);
        } finally {
            model.endUpdate();
        }

        graph.refresh(moduleCell);
    }


    // ---- Helpers for module typing ----                                               
    function isGardenModule(cell) {
        return !!cell && getXmlFlag(cell, "garden_module");
    }

    function isTeamModule(cell) {
        return !!cell && getXmlFlag(cell, "team_module");
    }

    function isGardenDashboardCell(cell) { // CHANGE
        return !!cell && cell.getAttribute && cell.getAttribute("garden_dashboard") === "1"; // CHANGE
    } // CHANGE

    // Safely set/remove a style flag key=1                                       
    function setStyleFlag(cell, key, on) {
        let st = getStyle(cell) || "";
        st = st.replace(new RegExp("(?:^|;)" + key + "=[^;]*(?=;|$)", "g"), "");
        if (on) st += (st && !st.endsWith(";") ? ";" : "") + key + "=1";
        model.setStyle(cell, st);
    }

    // Mirror to XML value node if present (optional)                             
    function setValueAttr(cell, key, on) {
        const v = cell.value;
        if (v && v.nodeType === 1) { // Element node                                    
            if (on) v.setAttribute(key, "1"); else v.removeAttribute(key);
            model.setValue(cell, v);
        }
    }


    // Ensure cell.value is an Element, preserving label if it was a string
    function ensureXmlValue(cell) {
        if (!cell) return null;
        let v = cell.value;
        if (v && v.nodeType === 1) return v; // already Element                                     
        const doc = mxUtils.createXmlDocument();
        const elt = doc.createElement("obj");
        const label = (typeof v === "string") ? v : "";
        if (label) elt.setAttribute("label", label);
        cell.value = elt;
        model.setValue(cell, elt);
        return elt;
    }

    // Read boolean XML attribute "key" (="1") off cell.value Element
    function getXmlFlag(cell, key) {
        const v = cell && cell.value;
        return (v && v.nodeType === 1 && v.getAttribute(key) === "1") ? true : false;
    }

    // Write/remove boolean XML attribute "key" on cell.value Element
    function setXmlFlag(cell, key, on) {
        const elt = ensureXmlValue(cell);
        if (!elt) return;
        if (on) elt.setAttribute(key, "1"); else elt.removeAttribute(key);
        model.setValue(cell, elt);
    }


    // Place a new child inside a module using abs click coords and a cell factory           
    function placeChildInModule(parentModule, absX, absY, makeChild /*(relX,relY)=>mxCell*/, opts) {
        const o = opts || {};
        const pg = graph.getCellGeometry(parentModule);
        const relX = pg ? (absX - pg.x) : absX;
        const relY = pg ? (absY - pg.y) : absY;

        let child = null;
        model.beginUpdate();
        try {
            child = makeChild(relX, relY);
            child && (child.vertex = true);
            if (child) model.add(parentModule, child);
            if (o.applyMargins !== false) {
                applyModuleMargins(parentModule);
                if (child) applyModuleMargins(child);
            }
        } finally {
            model.endUpdate();
        }
        if (o.select !== false && child) graph.setSelectionCell(child);
        return child;
    }

    function hasGardenSettingsSet(cell) {                                                     
        const v = cell && cell.value;                                                         
        if (!(v && v.nodeType === 1)) return false;                                           
        const city = (v.getAttribute("city_id") || v.getAttribute("city_name") || "").trim(); // CHANGED
        const units = (v.getAttribute("unit_system") || "").trim();                           
        return !!(city && units);                                                             
    }                                                                                         

    function emitGardenSettingsNeededIfMissing(graph, moduleCell) {                           
        if (!graph || !moduleCell) return;                                                    
        if (hasGardenSettingsSet(moduleCell)) return;                                         
        graph.fireEvent(new mxEventObject(                                                    
            "usl:gardenModuleNeedsSettings",                                                  
            "cell", moduleCell                                                                
        ));                                                                                   
    }                                                                                         


    function setModuleType(cell, type) {
        let becameGarden = false;                                                            

        model.beginUpdate();
        try {
            ensureXmlValue(cell);
            setXmlFlag(cell, "garden_module", false);
            setXmlFlag(cell, "team_module", false);

            // Set the desired flag
            if (type === "garden") {
                setXmlFlag(cell, "garden_module", true);                                     // FIX
                becameGarden = true;                                                        
            } else if (type === "team") {
                setXmlFlag(cell, "team_module", true);
            }

            let st = getStyle(cell) || "";
            st = st.replace(/(?:^|;)swimlaneFillColor=[^;]*(?=;|$)/g, "");
            st = st.replace(/;;+/g, ";").replace(/^;|;$/g, "");

            if (type === "garden") {
                st += (st ? ";" : "") + "swimlaneFillColor=#B9E0A5";
            } else if (type === "team") {
                st += (st ? ";" : "") + "swimlaneFillColor=#FFF2CC";
            } else {
                st += (st ? ";" : "") + "swimlaneFillColor=default";
            }

            model.setStyle(cell, st);
        } finally {
            model.endUpdate();
        }
        graph.refresh(cell);

        if (becameGarden) {                                                                  // CHANGE
            model.beginUpdate();                                                             // CHANGE
            try {                                                                            // CHANGE
                enforceGardenModuleMinimum(cell);                                            // CHANGE
                applyModuleMargins(cell, { allowShrink: false });                            // CHANGE
            } finally {                                                                      // CHANGE
                model.endUpdate();                                                           // CHANGE
            }                                                                                // CHANGE
        }                                                                                    // CHANGE

        if (becameGarden) {                                                                  // FIX
            setTimeout(() => emitGardenSettingsNeededIfMissing(graph, cell), 0);             // FIX
        }                                                                              
    }                                                                                        


        function isRoleCard(cell) {
        const st = getStyle(cell);
        if (!st) return false;
        if (/(^|;)role_card=1(;|$)/.test(st)) return true;             // primary signal
        // optional fallback: swimlane under a team module
        const p = model.getParent(cell);
        return /(^|;)swimlane(;|$)/.test(st) && !!p && isModule(p) && isTeamModule(p);
    }


    function createRoleCard(graph, moduleCell, x, y) {
        const w = 240, h = 160;
        const moduleGeo = graph.getCellGeometry(moduleCell);

        const relX = x - moduleGeo.x;
        const relY = y - moduleGeo.y;

        const role = new mxCell("Role", new mxGeometry(relX, relY, w, h),
            "shape=swimlane;horizontal=1;whiteSpace=wrap;collapsible=1;rounded=1;fillColor=#fff2cc;strokeColor=#d6b656;role_card=1");
        role.vertex = true;

        // Avatar placeholder (80px tall gray rectangle)
        const avatarGeo = new mxGeometry(5, 5, 30, 80);
        const avatar = new mxCell("Image", avatarGeo,
            "shape=rectangle;align=left;verticalAlign=middle;whiteSpace=wrap;fillColor=#f5f5f5;strokeColor=#999999;role_imagerow=1;");
        avatar.vertex = true;

        const name = new mxCell("Name", new mxGeometry(40, 0, w - 40, 30),
            "shape=rectangle;align=left;verticalAlign=middle;whiteSpace=wrap;fillColor=#ffffff;strokeColor=#d6b656;");
        name.vertex = true;

        const title = new mxCell("Role/Title", new mxGeometry(0, 30, w, 30),
            "shape=rectangle;align=left;verticalAlign=middle;whiteSpace=wrap;fillColor=#ffffff;strokeColor=#d6b656;");
        title.vertex = true;

        const notes = new mxCell("Description/Notes", new mxGeometry(0, 60, w, 60),
            "shape=rectangle;align=left;verticalAlign=top;whiteSpace=wrap;fillColor=#ffffff;strokeColor=#d6b656;");
        notes.vertex = true;

        const contact = new mxCell("Contact Info", new mxGeometry(0, 120, w, 30),
            "shape=rectangle;align=left;verticalAlign=middle;whiteSpace=wrap;fillColor=#ffffff;strokeColor=#d6b656;");
        contact.vertex = true;

        model.beginUpdate();
        try {
            model.add(moduleCell, role);
            [avatar, name, title, notes, contact].forEach(child => model.add(role, child));
        } finally {
            model.endUpdate();
        }
        return role;
    }


    function selectRoleImage(ui, graph, roleCard) {
        const model = graph.getModel();
        const origInsertVertex = graph.insertVertex;

        graph.insertVertex = function (parent, id, value, x, y, w, h, style, relative) {
            const cell = origInsertVertex.apply(this, arguments);

            if (style && style.includes("shape=image")) {
                // Delay to let Draw.io finish committing the inserted image
                setTimeout(() => {
                    model.beginUpdate();
                    try {
                        // Look for an existing image row in the roleCard
                        let children = model.getChildren(roleCard) || [];
                        let imageRow = children.find(c => (getStyle(c).includes("role_imagerow=1"))); // (CHANGED)

                        // If missing, create one at the top
                        if (!imageRow) {
                            const roleGeo = graph.getCellGeometry(roleCard);
                            const rowGeo = new mxGeometry(0, 0, roleGeo.width, 80); // 80px tall row
                            const rowStyle = "shape=rectangle;fillColor=#ffffff;strokeColor=#d6b656;role_imagerow=1;";
                            imageRow = new mxCell("", rowGeo, rowStyle);
                            imageRow.vertex = true;
                            model.add(roleCard, imageRow, 0);
                        }

                        // Remove any existing avatar inside this row
                        const rowChildren = model.getChildren(imageRow) || [];
                        rowChildren.forEach(c => {
                            if (getStyle(c).includes("role_avatar=1")) {
                                model.remove(c);
                            }
                        });

                        // Resize and position the new avatar
                        const geo = cell.getGeometry().clone();
                        geo.width = 70;
                        geo.height = 70;   // match avatar field height (80) minus margins
                        geo.x = 5; // padding
                        geo.y = 5;
                        model.setGeometry(cell, geo);

                        // Tag style
                        let newStyle = cell.getStyle() || "";
                        // Remove any existing instances first
                        newStyle = newStyle.replace(/role_avatar=1/g, "");
                        // Then append once
                        newStyle += ";role_avatar=1";
                        model.setStyle(cell, newStyle);


                        // Reparent into the image row
                        model.remove(cell);
                        model.add(imageRow, cell);
                    } finally {
                        model.endUpdate();
                    }

                    // Restore after image case
                    graph.insertVertex = origInsertVertex;
                }, 0);
            } else {
                // Restore immediately if not image
                graph.insertVertex = origInsertVertex;
            }

            return cell;
        };

        // Trigger the standard Insert → Image dialog
        ui.actions.get("insertImage").funct();
    }



    // --- Layout Manager for Role Cards ---
    graph.layoutManager = new mxLayoutManager(graph);
    graph.layoutManager.getLayout = function (cell) {
        if (cell != null && graph.getModel().isVertex(cell)) {
            const style = graph.getCurrentCellStyle(cell);
            if (style["fillColor"] === "#fff2cc") {
                const layout = new mxStackLayout(graph, false);
                layout.resizeParent = true;
                layout.fill = true;
                layout.border = 5;
                layout.marginLeft = 5;
                layout.marginRight = 5;
                return layout;
            }
        }
        return null;
    };

    // ------------------------
    // EVENT HOOKS (LIGHTWEIGHT)
    // ------------------------

    if (!graph.__uslHandlersInstalled) {
        graph.__uslHandlersInstalled = true;

        // NOTE: We keep edges/vertices default behavior (Draw.io handles containment).         

        graph.addListener(mxEvent.ADD_CELLS, function (sender, evt) {
            const cells = evt.getProperty("cells") || [];
            const seenModules = new Set();
            cells.forEach(c => {
                const p = model.getParent(c);
                if (p && isModule(p)) seenModules.add(p.id);
            });
             // children shouldn’t trigger shrink (usually expands only)
            seenModules.forEach(id => applyModuleMargins(model.getCell(id), { allowShrink: false }));
        });

        // Utility: get absolute bounds of a vertex, walking up parents      
        function getAbsBounds(cell) {
            const g = model.getGeometry(cell);
            if (!g || g.relative) return null;

            let x = g.x || 0;
            let y = g.y || 0;
            const w = g.width || 0;
            const h = g.height || 0;

            let p = model.getParent(cell);
            while (p) {
                const pg = model.getGeometry(p);
                if (pg && !pg.relative) {
                    x += pg.x || 0;
                    y += pg.y || 0;

                    // Adjust for swimlane header so child coordinates match visual position   
                    if (isModule(p) && isSwimlane(p)) {
                        const header = getStartSize(p).height || 0;
                        y += header;
                    }
                }
                p = model.getParent(p);
            }

            return { x, y, w, h };
        }


        // Tiler group classification – REUSE your existing version if you have one   
        function isTilerGroup(cell) {
            if (!cell) return false;
            // Example using XML attributes; adapt to your own schema if needed             
            const v = cell.value;
            if (v && v.nodeType === 1) {
                if (v.getAttribute("tiler_group") === "1") return true;
            }
            const st = getStyle(cell);
            return /(^|;)tiler_group=1(;|$)/.test(st);
        }

        // Does this cell sit under any tiler group in its ancestor chain?            
        function hasTilerGroupAncestor(cell) {
            let p = model.getParent(cell);
            while (p) {
                if (isTilerGroup(p)) return true;
                p = model.getParent(p);
            }
            return false;
        }

        // Filter to only top-level cells (no ancestor also in "cells")          
        function getTopLevelAddedCells(cells) {
            const idSet = new Set();
            cells.forEach(c => {
                if (c && c.id != null) idSet.add(c.id);
            });

            return cells.filter(c => {
                if (!c) return false;
                let p = model.getParent(c);
                while (p) {
                    if (p.id != null && idSet.has(p.id)) return false;
                    p = model.getParent(p);
                }
                return true;
            });
        }

        // Check if a cell already has a module ancestor                       
        function hasModuleAncestor(cell) {
            let p = model.getParent(cell);
            while (p) {
                if (isModule(p)) return true;
                p = model.getParent(p);
            }
            return false;
        }

        // Reparent only top-level cells that are not already under modules
        // and not children of tiler groups                                                
        function reparentCellsIntoModules(cells) {
            if (!cells || !cells.length) return;

            // Skip modules themselves; only auto-snap non-module vertices          
            cells = cells.filter(function (c) {
                return c && !isModule(c);
            });
            if (!cells.length) return;

            // 1) Only process top-level added cells (no ancestor also in "cells")         
            let topLevel = getTopLevelAddedCells(cells);
            if (!topLevel.length) return;

            // 2) Skip anything that already has a module ancestor                         
            topLevel = topLevel.filter(c => !hasModuleAncestor(c));
            if (!topLevel.length) return;

            // 3) Skip anything that has a tiler group ancestor (tiler internals)          
            topLevel = topLevel.filter(c => !hasTilerGroupAncestor(c));
            if (!topLevel.length) return;

            const modules = Object.values(model.cells)
                .filter(c => isModule(c));
            if (!modules.length) return;

            topLevel.forEach(cell => {
                if (!model.isVertex(cell)) return;

                const b = getAbsBounds(cell);
                if (!b) return;

                const containing = modules.filter(m => rectInsideModule(b, m));
                if (containing.length === 0) return;

                containing.sort((a, b2) => {
                    const ga = graph.getCellGeometry(a);
                    const gb = graph.getCellGeometry(b2);
                    return (ga.width * ga.height) - (gb.width * gb.height);
                });

                const targetModule = containing[0];
                const oldParent = model.getParent(cell);
                if (oldParent === targetModule) return;

                const g = cell.getGeometry();
                if (g) {
                    const mg = graph.getCellGeometry(targetModule);
                    if (mg) {
                        const headerH = isSwimlane(targetModule)
                            ? getStartSize(targetModule).height
                            : 0;

                        const g2 = g.clone();
                        g2.x = b.x - mg.x;
                        g2.y = b.y - (mg.y + headerH);
                        model.setGeometry(cell, g2);
                    }
                }

                model.add(targetModule, cell);
            });

            const touched = new Set();
            topLevel.forEach(c => {
                const p = model.getParent(c);
                if (p && isModule(p)) touched.add(p.id);
            });

            touched.forEach(id => applyModuleMargins(model.getCell(id)));
        }


        // After cells are added, defer reparenting to AFTER paste move     
        graph.addListener(mxEvent.CELLS_ADDED, function (sender, evt) {
            const cells = evt.getProperty("cells") || [];
            if (!cells.length) return;

            // Defer to next tick so paste offset/move is already applied             
            setTimeout(function () {
                model.beginUpdate();
                try {
                    reparentCellsIntoModules(cells);
                } finally {
                    model.endUpdate();
                }
            }, 0);
        });


        // Center-based containment: cell is "inside" if its center is inside module rect   
        function rectInsideModule(rect, modCell) {
            const mg = graph.getCellGeometry(modCell);
            if (!mg) return false;

            const cx = rect.x + rect.w / 2;  // center x                                             
            const cy = rect.y + rect.h / 2;  // center y                                             

            return (
                cx >= mg.x &&
                cx <= mg.x + mg.width &&
                cy >= mg.y &&
                cy <= mg.y + mg.height
            );
        }



        graph.addListener(mxEvent.CELLS_MOVED, function (sender, evt) {
            const cells = evt.getProperty("cells") || [];
            if (!cells.length) return;

            const seenModules = new Set();
            const toRoot = [];

            // Determine which children have left their module                          
            cells.forEach(c => {
                const p = model.getParent(c);
                if (!p) return;

                if (isModule(p)) {
                    const b = getAbsBounds(c);
                    if (!b) return;

                    // If no longer inside module content, mark for reparenting         
                    if (!rectInsideModule(b, p)) {
                        if (isGardenDashboardCell(c)) seenModules.add(p.id); // CHANGE
                        else toRoot.push({ cell: c, oldModule: p }); // CHANGE
                    } else {
                        seenModules.add(p.id);
                    }
                } else if (isModule(model.getParent(p))) {                              // optional: grandchild case
                    // If you only want direct children handled, you can remove this     
                    const mp = model.getParent(p);
                    if (mp && isModule(mp)) seenModules.add(mp.id);
                }
            });

            const root = graph.getDefaultParent();
            if (toRoot.length) {
                model.beginUpdate();
                try {
                    const rootGeo = model.getGeometry(root);
                    const rootX = (rootGeo && !rootGeo.relative) ? (rootGeo.x || 0) : 0;
                    const rootY = (rootGeo && !rootGeo.relative) ? (rootGeo.y || 0) : 0;

                    toRoot.forEach(({ cell, oldModule }) => {
                        const b = getAbsBounds(cell);
                        if (!b) return;

                        const g = cell.getGeometry();
                        if (!g) return;

                        const g2 = g.clone();
                        // Place at same page coordinates, now relative to root         
                        g2.x = b.x - rootX;
                        g2.y = b.y - rootY;
                        model.setGeometry(cell, g2);

                        // Reparent into root (or whatever parent you prefer)           
                        model.add(root, cell);

                        seenModules.add(oldModule.id);
                    });
                } finally {
                    model.endUpdate();
                }
            }

            // Shrink/expand modules after any reparenting                              
            seenModules.forEach(id => {
                const mod = model.getCell(id);
                if (mod) applyModuleMargins(mod, { allowShrink: true });
            });
        });


        graph.addListener(mxEvent.CELLS_RESIZED, function (sender, evt) {
            const cells = evt.getProperty("cells") || [];
            const seenModules = new Set();
            cells.forEach(c => {
                if (isGardenModule(c)) enforceGardenModuleMinimum(c);          // CHANGE
                if (isModule(c)) seenModules.add(c.id);                // module resized by user
                const p = model.getParent(c);
                if (p && isModule(p)) seenModules.add(p.id);           // child resized
            });
            // Do NOT shrink for module resize or child resize                                      
            seenModules.forEach(id => applyModuleMargins(model.getCell(id), { allowShrink: false }));
        });

    }

    // ------------------------
    // MODULE CREATION
    // ------------------------

    function createModuleCell(graph, x, y) {
        const parent = graph.getDefaultParent();
        const w = 160, h = 100;

        const moduleCell = new mxCell("",
            new mxGeometry(x, y, w, h),
            "swimlane;whiteSpace=wrap;html=1;swimlaneFillColor=default;module=1");
        moduleCell.vertex = true;
        model.add(parent, moduleCell);

        return moduleCell;
    }

    //  Role cards, menus, layouts etc… remain as you have them.
    // Ensure right-click does not alter selection unexpectedly                           
    graph.popupMenuHandler && (graph.popupMenuHandler.selectOnPopup = false);

    graph.__trellisModules = { // CHANGE
        applyModuleMargins: function (moduleCell, opts) { // CHANGE
            return applyModuleMargins(moduleCell, opts); // CHANGE
        }, // CHANGE
        enforceGardenModuleMinimum: function (moduleCell) { // CHANGE
            let changed = false; // CHANGE
            model.beginUpdate(); // CHANGE
            try { // CHANGE
                changed = enforceGardenModuleMinimum(moduleCell); // CHANGE
            } finally { // CHANGE
                model.endUpdate(); // CHANGE
            } // CHANGE
            return changed; // CHANGE
        }, // CHANGE
        getGardenModuleMinimumSize: function (moduleCell) { // CHANGE
            return getModuleMinOuterSize(moduleCell); // CHANGE
        } // CHANGE
    }; // CHANGE

    graph.addListener("usl:requestApplyModuleMargins", function (_sender, evt) { // CHANGE
        const cell = evt && evt.getProperty ? evt.getProperty("cell") : null; // CHANGE
        if (!cell || !isModule(cell)) return; // CHANGE
        model.beginUpdate(); // CHANGE
        try { // CHANGE
            enforceGardenModuleMinimum(cell); // CHANGE
            applyModuleMargins(cell, { allowShrink: false }); // CHANGE
        } finally { // CHANGE
            model.endUpdate(); // CHANGE
        } // CHANGE
    }); // CHANGE

    function registerTrellisContextMenuContributor(contributor) { // NEW
        function finishRegistration() { // NEW
            if (!window.TrellisContextMenu) return; // NEW
            window.TrellisContextMenu.install(ui); // NEW
            window.TrellisContextMenu.register(contributor); // NEW
        } // NEW

        if (window.TrellisContextMenu) { // NEW
            finishRegistration(); // NEW
        } else if (typeof mxscript === "function") { // NEW
            mxscript("plugins/garden_planner_plugins/Trellis_Context_Menu.js", finishRegistration); // NEW
        } // NEW
    } // NEW

    registerTrellisContextMenuContributor({ // CHANGE
        id: "modules", // NEW
        priority: 100, // NEW
        addItems: function (menu, cell, evt) { // CHANGE

        // Add Module on background or right-click on module
        if (!cell) {
            menu.addItem("Add Module", null, function () {
                const pt = graph.getPointForEvent(evt);
                model.beginUpdate();
                try {
                    const mod = createModuleCell(graph, pt.x, pt.y);
                    applyModuleMargins(mod);
                    graph.setSelectionCell(mod);
                } finally {
                    model.endUpdate();
                }
            });
        }

        if (cell && isModule(cell)) {
            const isGarden = isGardenModule(cell);
            const isTeam = isTeamModule(cell);

            // Toggle options based on current type                                       
            if (!isGarden && !isTeam) {
                menu.addItem("Set as Garden Module", null, function () {
                    setModuleType(cell, "garden");
                });
                menu.addItem("Set as Team Module", null, function () {
                    setModuleType(cell, "team");
                });
            } else {
                menu.addItem("Set as Regular Module", null, function () {
                    setModuleType(cell, "regular");
                });
            }
            // Add Submodule (child module with relative coordinates)               
            menu.addItem("Add Submodule", null, function () {
                const pt = graph.getPointForEvent(evt);
                const sub = placeChildInModule(
                    cell,                                                           // parent module
                    pt.x,                                                           // abs X
                    pt.y,                                                           // abs Y
                    function (relX, relY) {                                         // factory: create submodule
                        const w = 160, h = 100;                                     // match createModuleCell defaults
                        const subCell = new mxCell(
                            "",
                            new mxGeometry(relX, relY, w, h),
                            "swimlane;whiteSpace=wrap;html=1;swimlaneFillColor=default;module=1"
                        );
                        subCell.vertex = true;
                        return subCell;
                    },
                    { applyMargins: true }                                         // optional, keeps parent margins updated
                );
                if (sub) {
                    graph.setSelectionCell(sub);
                }
            });

            // Keep your existing margin editor (using ui.prompt)                         
            menu.addItem("Set Module Margin (px)…", null, function () {
                const target = cell;
                const cur = getIntStyle(target, "module_margin", 100);
                if (graph.popupMenuHandler && graph.popupMenuHandler.hideMenu) {
                    graph.popupMenuHandler.hideMenu();
                }
                setTimeout(function () {
                    ui.prompt("Module internal margin (px):", String(cur), function (val) {
                        if (val == null) return;
                        const n = Math.max(0, parseInt(val, 10) || 0);

                        // Cleanly replace/add module_margin in style                                 
                        let st = getStyle(target) || "";
                        st = st.replace(/(?:^|;)module_margin=\d+(?=;|$)/, "");
                        st = st.replace(/;;+/g, ";").replace(/^;|;$/g, "");
                        st += (st ? ";" : "") + "module_margin=" + n;

                        model.beginUpdate();
                        try {
                            model.setStyle(target, st);
                            applyModuleMargins(target);
                        } finally {
                            model.endUpdate();
                        }
                    });
                }, 0);
            });

            // Team module gets Add Role Card                                             
            if (isTeam) {
                menu.addItem("Add Role Card", null, function () {
                    const pt = graph.getPointForEvent(evt);
                    model.beginUpdate();
                    try {
                        const role = createRoleCard(graph, cell, pt.x, pt.y);
                        graph.setSelectionCell(role);
                        applyModuleMargins(cell);
                    } finally {
                        model.endUpdate();
                    }
                });
            }

            // --- Role Card specific action ------------------------------------------------
            if (cell && isRoleCard(cell)) {
                menu.addSeparator();
                menu.addItem("Select Role Image", null, function () {
                    selectRoleImage(ui, graph, cell);
                });
            }

        }
        } // CHANGE
    }); // CHANGE

});

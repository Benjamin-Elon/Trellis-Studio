Trellis Studio extends Draw.io with a coordinated suite of plugins that turn diagrams into a spacial garden planning and management system.

**Licensing:** Trellis Studio is a mixed-license distribution. Upstream draw.io and third-party material keep their existing notices, while Trellis-owned additions are source-available for community and noncommercial use. Commercial use of Trellis-owned additions requires written approval. See [drawio-desktop/LICENSES.md](drawio-desktop/LICENSES.md).

**Features:**

- Create comprehensive yearly business/garden plans.
- Draw beds, garden zones, and modules.
- Drag crops into place and generate schedules based on climate, GDD, frost windows, and plant traits.
- Plan multi-crop successions and turnovers.
- Design irrigation systems.
- Manage and coordinate tasks with Automated, linked Kanban boards.
- Build multi-person workflows and ownership using role cards and team modules.
- Automatically track and visualize when diagram elements were created or edited, using time-based coloring, filtering, and navigation to explore change history directly on the canvas.
- In addition to all the base features included in Draw.io

**Who This Is For**

- Home gardeners
- Market gardeners
- School garden programs and teachers
- Urban agriculture projects
- Designers seeking visual + computational diagrams
- Anyone who dislikes juggling spreadsheets and calendar apps
- Ecological Landscapers
- Plant Nurseries

**Why Draw.io?** 

Draw.io offers:

- A fast, responsive graphical canvas
- XML-structured shapes (ideal for embedding data)
- A plugin system with full graph access
- Zero required server dependencies (extensible for web, app and server)
- Compatibility with existing Draw.io diagrams

**To run this:**

1. yarn install (in the root directory of this repo)
2. yarn.cmd start (in the root directory of this repo runs the app. For debugging, use npm start --enable-logging.)

**To Build The Project:** 

In the root directory of this repo:
1. yarn.cmd release:prepare


**Getting started:**

1. Install, Run or build the project.
2. Go to plugin menu (under extras) and install the built in plugins.
3. Create modules --> team and garden modules
4. Most actions are in the right click context menu.
5. **Have Fun and contribute if you so desire!**

I have big plans for this project.

Eventually, I would like this to become a community-level coordination and planning environment.

Collaborative peer-networked diagramming, always local first.  

**High priority TODO Features:**
- Add automatic fit garden plantings to year plan plugin
- Add users plugin and extend changeMap plugin with user selector
- Extend planner to include bed turnover and companion mode
- Extend scheduler with proper perennial scheduling.
- Add labor plugin

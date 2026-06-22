const fs = require('fs')
const path = require('path')

const appjsonpath = path.join(__dirname, 'package.json')
const disableUpdatePath = path.join(__dirname, 'src/main', 'disableUpdate.js')

let drawioBaseVersion = fs.readFileSync(path.join(__dirname, 'drawio', 'VERSION'), 'utf8').trim() // Trellis release: track upstream without replacing app semver.

let pj = require(appjsonpath)

pj.drawioBaseVersion = drawioBaseVersion // Trellis release: preserve independent package.json version for GitHub tags.

fs.writeFileSync(appjsonpath, JSON.stringify(pj, null, 2), 'utf8')
//Enable/disable updates
fs.writeFileSync(disableUpdatePath, 'export function disableUpdate() { return ' + (process.argv[2] == 'disableUpdate'? 'true' : 'false') + ';}', 'utf8');

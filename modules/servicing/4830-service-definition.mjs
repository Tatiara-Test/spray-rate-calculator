const MACHINE = "4830";

const rawTasks = [
  ["machine-p1-r01",1,1,"machine-excluding-boom","Tighten lug nuts",["10-hours"],{ initialBreakIn:true }],
  ["machine-p1-r02",1,2,"machine-excluding-boom","Tighten foam marker straps",["10-hours"],{ initialBreakIn:true }],
  ["machine-p1-r03",1,3,"machine-excluding-boom","Check suspension scissors",["10-hours"],{ initialBreakIn:true }],
  ["machine-p1-r04",1,4,"machine-excluding-boom","Check solution tank straps",["10-hours"],{ initialBreakIn:true }],
  ["machine-p1-r05",1,5,"machine-excluding-boom","Change planetary hub oil",["50-hours"],{ initialBreakIn:true }],
  ["machine-p1-r06",1,6,"machine-excluding-boom","Check tread adjust side gap and shim gap",["100-hours"],{ initialBreakIn:true }],
  ["machine-p1-r07",1,7,"machine-excluding-boom","Change engine oil and filter",["100-hours"],{ initialBreakIn:true }],
  ["machine-p1-r08",1,8,"machine-excluding-boom","Check engine oil level",["daily"]],
  ["machine-p1-r09",1,9,"machine-excluding-boom","Check coolant level",["daily"]],
  ["machine-p1-r10",1,10,"machine-excluding-boom","Check hydraulic oil level",["daily"]],
  ["machine-p1-r11",1,11,"machine-excluding-boom","Drain water and sediment from fuel filters",["daily"]],
  ["machine-p1-r12",1,12,"machine-excluding-boom","Clean solution strainers",["daily"]],
  ["machine-p1-r13",1,13,"machine-excluding-boom","Lubricate suspension assemblies",["daily"]],
  ["machine-p1-r14",1,14,"machine-excluding-boom","Rinse solution pump, flowmeter, and boom",["daily"]],
  ["machine-p1-r15",1,15,"machine-excluding-boom","Drain moisture from on board air tank",["daily"]],
  ["machine-p1-r16",1,16,"machine-excluding-boom","Check tires for damage and correct inflation pressure",["daily"]],
  ["machine-p1-r17",1,17,"machine-excluding-boom","Check air springs",["daily"]],
  ["machine-p1-r18",1,18,"machine-excluding-boom","Clean flowmeter",["daily"]],
  ["machine-p1-r19",1,19,"machine-excluding-boom","Clean screens and cooling package",["as-required"]],
  ["machine-p1-r20",1,20,"machine-excluding-boom","Clean fill strainer",["as-required"]],
  ["machine-p1-r21",1,21,"machine-excluding-boom","Clean boom filter",["as-required"]],
  ["machine-p1-r22",1,22,"machine-excluding-boom","Replace cab air filters",["as-required"]],
  ["machine-p1-r23",1,23,"machine-excluding-boom","Replace engine air filters",["as-required"]],
  ["machine-p1-r24",1,24,"machine-excluding-boom","Inspect and replace fan belt",["as-required"]],
  ["machine-p1-r25",1,25,"machine-excluding-boom","Add coolant conditioner",["as-required"]],
  ["machine-p1-r26",1,26,"machine-excluding-boom","Lubricate steering cylinder ball joints and rotating steering arms",["100-hours"]],
  ["machine-p1-r27",1,27,"machine-excluding-boom","Check and lubricate suspension scissors",["100-hours"]],
  ["machine-p1-r28",1,28,"machine-excluding-boom","Inspect brake components",["100-hours"]],
  ["machine-p1-r29",1,29,"machine-excluding-boom","Tighten lug nuts",["100-hours"]],
  ["machine-p1-r30",1,30,"machine-excluding-boom","Check tread adjust side gap and shim gap",["250-hours"]],
  ["machine-p1-r31",1,31,"machine-excluding-boom","Change engine oil and filter",["250-hours"]],
  ["machine-p1-r32",1,32,"machine-excluding-boom","Check solution tank straps",["250-hours"]],
  ["machine-p1-r33",1,33,"machine-excluding-boom","Lubricate driveshaft U-joints",["250-hours"]],
  ["machine-p2-r01",2,1,"machine-excluding-boom","Service batteries",["250-hours"]],
  ["machine-p2-r02",2,2,"machine-excluding-boom","Rotate tires",["250-hours"]],
  ["machine-p2-r03",2,3,"machine-excluding-boom","Replace hydrostatic and hydraulic filters",["500-hours"]],
  ["machine-p2-r04",2,4,"machine-excluding-boom","Change hydraulic oil",["500-hours"]],
  ["machine-p2-r05",2,5,"machine-excluding-boom","Change planetary hub oil",["500-hours"]],
  ["machine-p2-r06",2,6,"machine-excluding-boom","Replace fuel filters",["500-hours"]],
  ["machine-p2-r07",2,7,"machine-excluding-boom","Replace cab air filters",["500-hours","1-year"]],
  ["machine-p2-r08",2,8,"machine-excluding-boom","Replace air compressor air dryer cartridge",["1-year"]],
  ["machine-p2-r09",2,9,"machine-excluding-boom","Inspect seat belt",["1-year"]],
  ["machine-p2-r10",2,10,"machine-excluding-boom","Clean engine vent tube",["1-year"]],
  ["machine-p2-r11",2,11,"machine-excluding-boom","Inspect hydro isolators",["1-year"]],
  ["machine-p2-r12",2,12,"machine-excluding-boom","Remove and inspect brake components",["1-year"]],
  ["machine-p2-r13",2,13,"machine-excluding-boom","Check front end toe-in",["1-year"]],
  ["machine-p2-r14",2,14,"machine-excluding-boom","Clean sprayer and coat exposed surfaces",["1-year"]],
  ["machine-p2-r15",2,15,"machine-excluding-boom","Test coolant",["1-year","750-hours"]],
  ["machine-p2-r16",2,16,"machine-excluding-boom","Check air intake system",["750-hours"]],
  ["machine-p2-r17",2,17,"machine-excluding-boom","Check engine speeds",["750-hours"]],
  ["machine-p2-r18",2,18,"machine-excluding-boom","Check belt tensioner",["1500-hours"]],
  ["machine-p2-r19",2,19,"machine-excluding-boom","Adjust engine valve clearance",["2000-hours"],{ dealerServiceMarker:true }],
  ["machine-p2-r20",2,20,"machine-excluding-boom","Replace engine crankshaft damper",["5000-hours"],{ dealerServiceMarker:true }],
  ["machine-p2-r21",2,21,"machine-excluding-boom","Drain, flush, and refill engine cooling system",["5000-hours"],{ coolantIntervalFootnote:true }],
  ["machine-p2-r22",2,22,"machine-excluding-boom","Test or replace thermostats and radiator cap",["5000-hours"]],
  ["boom-p3-r01",3,1,"boom","Tighten boom assembly",["10-hours"],{ initialBreakIn:true }],
  ["boom-p3-r02",3,2,"boom","Grease boom fold lock out",["daily"]],
  ["boom-p3-r03",3,3,"boom","Lubricate boom lift arm pivots",["10-hours"],{ boomLocationLabels:["D"] }],
  ["boom-p3-r04",3,4,"boom","Lubricate center section",["50-hours"],{ boomLocationLabels:["A"] }],
  ["boom-p3-r05",3,5,"boom","Lubricate breakaway chain pivot and hinge",["50-hours"],{ boomLocationLabels:["C"] }],
  ["boom-p3-r06",3,6,"boom","Lubricate outer boom hinge",["50-hours"],{ boomLocationLabels:["B"] }],
  ["boom-p3-r07",3,7,"boom","Tighten boom assembly",["50-hours"]],
];

const manualPages = Object.freeze({ 1:"95-3", 2:"95-4", 3:"100-1" });
const selectionGroups = Object.freeze([
  "initial-10-hours", "initial-50-hours", "initial-100-hours", "daily", "as-required",
  "10-hours", "50-hours", "100-hours", "250-hours", "500-hours", "1-year",
  "750-hours", "1500-hours", "2000-hours", "5000-hours",
]);
const groupSet = new Set(selectionGroups);

const tasks = rawTasks.map(([id,page,row,section,label,intervals,flags = {}]) => ({
  id,
  page,
  row,
  manualPage: manualPages[page],
  section,
  label,
  intervals,
  selectionGroups: flags.initialBreakIn ? intervals.map((interval) => `initial-${interval}`) : [...intervals],
  initialBreakIn: flags.initialBreakIn === true,
  dealerServiceMarker: flags.dealerServiceMarker === true,
  coolantIntervalFootnote: flags.coolantIntervalFootnote === true,
  boomLocationLabels: flags.boomLocationLabels ? [...flags.boomLocationLabels] : [],
}));

const content = {
  definitionId: "pallathorpe-enterprises-4830-service-v1",
  definitionVersion: 1,
  machine: MACHINE,
  acceptance: {
    status: "owner-accepted-isolated-build",
    basis: "visual-reconciliation-of-user-supplied-three-page-scan",
    reconciledAt: "2026-08-12",
    manufacturerCertified: false,
  },
  selectableIntervalGroups: selectionGroups,
  tasks,
  boomLocations: [
    { label:"A", description:"Center frame", interval:"50-hours", fittingLocations:13, eachSide:false },
    { label:"B", description:"Inner to outer boom hinge", interval:"50-hours", fittingLocations:6, eachSide:true },
    { label:"C", description:"Outer to breakaway boom hinge and chain pivot", interval:"50-hours", fittingLocations:2, eachSide:true },
    { label:"D", description:"Lift arms", interval:"10-hours", fittingLocations:5, eachSide:true },
  ],
  sourceNotes: [
    { id:"coolant-interval", text:"Initial cooling-system change interval is 3 years or 3000 hours. The scheduled interval of 2 years or 2000 hours may be extended to 5 years or 5000 hours when John Deere COOL-GARD is used.", appliesToTaskIds:["machine-p2-r21"] },
    { id:"dealer-service", text:"See your John Deere dealer for service.", appliesToTaskIds:["machine-p2-r19","machine-p2-r20"] },
    { id:"boom-tightening", text:"Tighten boom fasteners and inspect the boom for proper adjustment after the first day (10 hours) of use and every 50 hours thereafter.", appliesToTaskIds:["boom-p3-r01","boom-p3-r07"] },
  ],
};

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function assertDefinition() {
  if (tasks.length !== 62) throw new Error("The 4830 service definition must contain 62 source rows.");
  const ids = new Set();
  const coordinates = new Set();
  for (const task of tasks) {
    const coordinate = `${task.page}:${task.row}`;
    if (ids.has(task.id) || coordinates.has(coordinate)) throw new Error("The 4830 service definition contains duplicate source identity.");
    if (!task.selectionGroups.length || task.selectionGroups.some((group) => !groupSet.has(group))) {
      throw new Error(`The 4830 service definition has an invalid interval group for ${task.id}.`);
    }
    ids.add(task.id);
    coordinates.add(coordinate);
  }
  if (tasks.filter(({ page }) => page === 1).length !== 33
    || tasks.filter(({ page }) => page === 2).length !== 22
    || tasks.filter(({ page }) => page === 3).length !== 7) {
    throw new Error("The 4830 service definition page counts do not match the reconciled source.");
  }
}

assertDefinition();

export const SERVICE_DEFINITION_CANONICAL = stableStringify(content);
export const SERVICE_DEFINITION_HASH = "sha256-ecc6edb2c4e52a4f15095890ad91e9fa7dcab19189f6d3831edf6e18523eab91";
export const SERVICE_INTERVAL_GROUPS = selectionGroups;
export const SERVICE_DEFINITION_4830 = deepFreeze({ ...content, definitionHash: SERVICE_DEFINITION_HASH });

export function serviceTasksForIntervalGroups(groups) {
  if (!Array.isArray(groups) || !groups.length) throw new TypeError("Select at least one servicing interval group.");
  const selected = new Set(groups);
  if (selected.size !== groups.length || groups.some((group) => !groupSet.has(group))) {
    throw new TypeError("Servicing interval selection is invalid.");
  }
  return SERVICE_DEFINITION_4830.tasks.filter((task) => task.selectionGroups.some((group) => selected.has(group)));
}

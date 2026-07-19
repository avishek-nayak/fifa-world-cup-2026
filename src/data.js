/**
 * @file Incident scenarios and staff pools.
 *
 * Separated from the engine so the routing model can be tested against
 * arbitrary fixtures, and so a live incident feed can replace this module
 * without touching scoring logic.
 *
 * @module data
 */

export const SCENARIOS = Object.freeze([
  {
    task:{ title:'Wet floor — Gate A entrance surge', origin:'Camera + 2 fan reports', zone:'east',
           needRole:'facilities', needCerts:['wet-floor'], slaSec:360, priority:'crit', mode:'urgent', loc:'Gate A · L1' },
    pool:[
      { name:'Ravi Kulkarni', role:'facilities', initials:'RK', unit:'Facilities · Zone East',
        certs:['wet-floor','hazmat'], onShift:true, shiftLeftMin:180, status:'active', zoneAccess:['east','concourse'],
        etaSec:108, state:'idle', doneThisShift:6,
        capability:{ seniority:0.85, kit:1.0, history:0.9 }, continuity:{ zoneShifts:3, similarTasks:4 } },
      { name:'Sana Mirza', role:'facilities', initials:'SM', unit:'Facilities · Zone West',
        certs:['wet-floor'], onShift:true, shiftLeftMin:150, status:'active', zoneAccess:['west','concourse','east'],
        etaSec:295, state:'finishing', doneThisShift:9,
        capability:{ seniority:0.7, kit:0.6, history:0.75 }, continuity:{ zoneShifts:0, similarTasks:2 } },
      { name:'Deepak Rao', role:'facilities', initials:'DR', unit:'Facilities · Zone East',
        certs:['wet-floor'], onShift:true, shiftLeftMin:95, status:'active', zoneAccess:['east'],
        etaSec:150, state:'active', doneThisShift:11,
        capability:{ seniority:0.5, kit:0.7, history:0.6 }, continuity:{ zoneShifts:2, similarTasks:1 } },
      { name:'Marcus Tello', role:'security', initials:'MT', unit:'Security · Zone East',
        certs:['crowd-l3'], onShift:true, shiftLeftMin:200, status:'active', zoneAccess:['east'],
        etaSec:60, state:'idle', doneThisShift:3,
        capability:{ seniority:0.9, kit:0.2, history:0.3 }, continuity:{ zoneShifts:3, similarTasks:0 } }
    ]
  },
  {
    task:{ title:'Aggressive fan — Section 118 aisle', origin:'Steward radio · channel 1', zone:'east',
           needRole:'security', needCerts:['crowd-l3'], slaSec:180, priority:'crit', mode:'urgent', loc:'Sec 118 · L2' },
    pool:[
      { name:'Marcus Tello', role:'security', initials:'MT', unit:'Security · Zone East',
        certs:['crowd-l3','restraint'], onShift:true, shiftLeftMin:200, status:'active', zoneAccess:['east'],
        etaSec:42, state:'idle', doneThisShift:3,
        capability:{ seniority:0.9, kit:0.9, history:0.95 }, continuity:{ zoneShifts:3, similarTasks:3 } },
      { name:'Priya Shah', role:'security', initials:'PS', unit:'Security · Zone West',
        certs:['crowd-l3'], onShift:true, shiftLeftMin:170, status:'active', zoneAccess:['west','east'],
        etaSec:140, state:'idle', doneThisShift:5,
        capability:{ seniority:0.75, kit:0.8, history:0.7 }, continuity:{ zoneShifts:1, similarTasks:2 } },
      { name:'Jonas Berg', role:'security', initials:'JB', unit:'Security · Zone East',
        certs:[], onShift:true, shiftLeftMin:120, status:'active', zoneAccess:['east'],
        etaSec:38, state:'idle', doneThisShift:2,
        capability:{ seniority:0.4, kit:0.5, history:0.4 }, continuity:{ zoneShifts:2, similarTasks:0 } },
      { name:'Ravi Kulkarni', role:'facilities', initials:'RK', unit:'Facilities · Zone East',
        certs:['wet-floor'], onShift:true, shiftLeftMin:180, status:'active', zoneAccess:['east'],
        etaSec:75, state:'idle', doneThisShift:6,
        capability:{ seniority:0.85, kit:0.1, history:0.1 }, continuity:{ zoneShifts:3, similarTasks:0 } }
    ]
  },
  {
    task:{ title:'Fan collapsed — Section 104 concourse', origin:'Fan app SOS + camera', zone:'concourse',
           needRole:'medical', needCerts:['first-aid'], slaSec:120, priority:'crit', mode:'urgent', loc:'Sec 104 · L1' },
    pool:[
      { name:'Aisha Bello', role:'medical', initials:'AB', unit:'Medical · Roaming',
        certs:['first-aid','defib','paramedic'], onShift:true, shiftLeftMin:210, status:'active', zoneAccess:['concourse','east','west'],
        etaSec:52, state:'idle', doneThisShift:2,
        capability:{ seniority:1.0, kit:1.0, history:0.95 }, continuity:{ zoneShifts:2, similarTasks:3 } },
      { name:'Tom Hendricks', role:'medical', initials:'TH', unit:'Medical · First-aid post 2',
        certs:['first-aid','defib'], onShift:true, shiftLeftMin:160, status:'active', zoneAccess:['concourse'],
        etaSec:98, state:'finishing', doneThisShift:4,
        capability:{ seniority:0.7, kit:0.85, history:0.7 }, continuity:{ zoneShifts:1, similarTasks:2 } },
      { name:'Lena Ortiz', role:'medical', initials:'LO', unit:'Medical · Post 4',
        certs:['first-aid'], onShift:true, shiftLeftMin:40, status:'on-break', zoneAccess:['concourse'],
        etaSec:70, state:'idle', doneThisShift:1,
        capability:{ seniority:0.6, kit:0.5, history:0.6 }, continuity:{ zoneShifts:1, similarTasks:1 } }
    ]
  },
  {
    task:{ title:'Bin overflow — Gate D concourse', origin:'Waste sensor · 84% capacity', zone:'concourse',
           needRole:'facilities', needCerts:[], slaSec:1800, priority:'low', mode:'routine', loc:'Gate D · L1' },
    pool:[
      { name:'Ravi Kulkarni', role:'facilities', initials:'RK', unit:'Facilities · Zone East',
        certs:['wet-floor','hazmat'], onShift:true, shiftLeftMin:180, status:'active', zoneAccess:['east','concourse'],
        etaSec:210, state:'idle', doneThisShift:12,
        capability:{ seniority:0.85, kit:0.8, history:0.85 }, continuity:{ zoneShifts:3, similarTasks:4 } },
      { name:'Sana Mirza', role:'facilities', initials:'SM', unit:'Facilities · Zone West',
        certs:['wet-floor'], onShift:true, shiftLeftMin:150, status:'active', zoneAccess:['west','concourse'],
        etaSec:340, state:'idle', doneThisShift:2,
        capability:{ seniority:0.7, kit:0.7, history:0.75 }, continuity:{ zoneShifts:1, similarTasks:2 } },
      { name:'Deepak Rao', role:'facilities', initials:'DR', unit:'Facilities · Zone East',
        certs:['wet-floor'], onShift:true, shiftLeftMin:95, status:'active', zoneAccess:['east','concourse'],
        etaSec:260, state:'idle', doneThisShift:11,
        capability:{ seniority:0.5, kit:0.7, history:0.6 }, continuity:{ zoneShifts:2, similarTasks:3 } }
    ]
  }
]);

/** Isolated research registry. It does not modify or import the production engine. */
export const SCHEMA_VERSION = 1;
export const REGISTRY_VERSION = 'poe-capabilities/1';
export const ENGINE_SHA256 = 'd64cac3f8ceddd25924dab9d546d89fab06760f2afa98ba76b5e14c9eb8568d5';
export const own = (o, k) => o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
export function freeze(value) {
  if (value && typeof value === 'object') { for (const v of Object.values(value)) freeze(v); Object.freeze(value); }
  return value;
}
const C = [[0,-1],[1,0],[0,1],[-1,0]], D = [[-1,-1],[1,-1],[-1,1],[1,1]];
const G = [[0,-1],[-1,-1],[1,-1],[-1,0],[1,0],[0,1]], S = [[0,-1],...D];
export const PIECES = freeze({
  pawn:{dirs:[[0,-1]],actions:['thrust'],promote:'tokin'},
  lance:{dirs:[[0,-1]],actions:['charge'],promote:'promoted_lance'},
  knight:{dirs:[],actions:['jump'],promote:'promoted_knight'},
  silver:{dirs:S,actions:['sweep'],promote:'promoted_silver'},
  gold:{dirs:G,actions:['sweep']}, bishop:{dirs:D,actions:['charge'],promote:'horse'},
  rook:{dirs:C,actions:['charge'],promote:'dragon'}, king:{dirs:[...C,...D],actions:['sweep']},
  tokin:{dirs:G,actions:['sweep']}, promoted_lance:{dirs:G,actions:['sweep']},
  promoted_knight:{dirs:G,actions:['sweep']}, promoted_silver:{dirs:G,actions:['sweep']},
  horse:{dirs:[...C,...D],actions:['sweep','charge']}, dragon:{dirs:[...C,...D],actions:['sweep','charge']}
});
/** native-v50 = implemented only for its original piece/actor scope, never an arbitrary grant. */
export const ABILITIES = freeze({
  thrust:{label:'突き',kind:'attack',requires:[],implementation:'native-v50',cooldownGroup:'melee',engineCooldown:'sweepCooldown',adapter:'v50.thrust'},
  sweep:{label:'斬撃',kind:'attack',requires:[],implementation:'native-v50',cooldownGroup:'melee',engineCooldown:'sweepCooldown',adapter:'v50.sweep'},
  charge:{label:'突撃',kind:'attack',requires:[],implementation:'native-v50',cooldownGroup:'charge',engineCooldown:'cooldown',adapter:'v50.charge'},
  jump:{label:'ジャンプ',kind:'mobility',requires:[],implementation:'native-v50',cooldownGroup:'jump',engineCooldown:'jumpCooldown',adapter:'v50.knightJump'},
  guard:{label:'防御',kind:'defense',requires:[],implementation:'native-v50',cooldownGroup:null,engineCooldown:null,adapter:'v50.setGuard'},
  step_attack:{label:'一歩攻撃',kind:'attack',requires:['sweep'],implementation:'native-v50',cooldownGroup:'step',engineCooldown:'stepCooldown',adapter:'v50.dragonStep'},
  double_jump:{label:'二段ジャンプ',kind:'mobility',requires:['jump'],implementation:'contract-only',cooldownGroup:'jump',engineCooldown:null,adapter:null},
  thrust_followup:{label:'突きの追撃',kind:'combo',requires:['thrust'],implementation:'contract-only',cooldownGroup:'melee',engineCooldown:null,adapter:null},
  sweep_followup:{label:'斬撃の追撃',kind:'combo',requires:['sweep'],implementation:'contract-only',cooldownGroup:'melee',engineCooldown:null,adapter:null},
  charge_followup:{label:'突撃の追撃',kind:'combo',requires:['charge'],implementation:'contract-only',cooldownGroup:'charge',engineCooldown:null,adapter:null}
});
export const ABILITY_IDS = freeze(Object.keys(ABILITIES));
// Explicit, frozen expansion. New registry releases must not silently grant future abilities.
export const ALL_REGISTERED_V1 = freeze(['thrust','sweep','charge','jump','guard','step_attack','double_jump','thrust_followup','sweep_followup','charge_followup']);
export const TEMPLATES = freeze({
  standard:{label:'標準',defaultRig:'samurai-v50',combatDefaults:null},
  kunoichi:{label:'くノ一',defaultRig:'kunoichi-pending',combatDefaults:null}
});
export const RIGS = freeze({
  'samurai-v50':{status:'native-v50',npcSkeleton:true},
  'kunoichi-pending':{status:'unimplemented',npcSkeleton:false}
});
export function defaultAbilities(piece, role='hero') {
  if (!own(PIECES,piece)) throw new TypeError('Unknown piece');
  const ids = new Set(PIECES[piece].actions);
  // NPC v50 does not have the controlled hero's held-guard or pad step execution.
  if (role === 'hero' && !['pawn','lance','knight'].includes(piece)) ids.add('guard');
  if (role === 'hero' && ['horse','dragon'].includes(piece)) ids.add('step_attack');
  return Object.fromEntries(ABILITY_IDS.map(id=>[id,ids.has(id)]));
}

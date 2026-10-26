// Explicit appearance-only opt-in for the current original samurai rig.
// Unknown pieces and named styles keep every optional presentation layer off.
export const ORIGINAL_RIG_STYLE = 'original-samurai';
const AUTHORED = Object.freeze({forwardThrustGait:false,directionalSweepGait:false,dynamicAttacks:false,dynamicGuard:false,dynamicJump:false,stylizedDash:false});
const FORWARD_THRUST = Object.freeze({...AUTHORED,forwardThrustGait:true,dynamicAttacks:true});
const FORWARD_CHARGE = Object.freeze({...FORWARD_THRUST,stylizedDash:true});
const DIRECTIONAL_SWEEP = Object.freeze({...AUTHORED,directionalSweepGait:true,dynamicAttacks:true,dynamicGuard:true});
const SWEEP_CHARGE = Object.freeze({...DIRECTIONAL_SWEEP,stylizedDash:true});
const BRACED_CHARGE = Object.freeze({...AUTHORED,dynamicGuard:true,stylizedDash:true});
const KNIGHT_JUMP = Object.freeze({...AUTHORED,dynamicJump:true});
const ORIGINAL_RIG_PROFILES = Object.freeze({
  pawn:FORWARD_THRUST,lance:FORWARD_CHARGE,knight:KNIGHT_JUMP,
  rook:BRACED_CHARGE,bishop:BRACED_CHARGE,
  king:DIRECTIONAL_SWEEP,gold:DIRECTIONAL_SWEEP,silver:DIRECTIONAL_SWEEP,
  tokin:DIRECTIONAL_SWEEP,promoted_lance:DIRECTIONAL_SWEEP,
  promoted_knight:DIRECTIONAL_SWEEP,promoted_silver:DIRECTIONAL_SWEEP,
  dragon:SWEEP_CHARGE,horse:SWEEP_CHARGE,
});
const PREWARM = Object.freeze({dynamicGuard:true,dynamicJump:true});
const NO_PREWARM = Object.freeze({dynamicGuard:false,dynamicJump:false});
export function samuraiMotionProfile(piece,style=ORIGINAL_RIG_STYLE,capabilities=null) {
  const profile=style===ORIGINAL_RIG_STYLE && Object.prototype.hasOwnProperty.call(ORIGINAL_RIG_PROFILES,piece)
    ? ORIGINAL_RIG_PROFILES[piece] : AUTHORED;
  // Only the current rig and explicit controlled-pawn adapter receive this layer.
  // Preserve the piece's original gait; do not substitute a knight or a new rig.
  return style===ORIGINAL_RIG_STYLE&&['pawn','tokin'].includes(piece)&&capabilities?.forwardHop===true&&capabilities?.abilities?.jump===true
    ? {...profile,dynamicJump:true,capabilityHop:true} : profile;
}
export function samuraiPresentationOptions(style) {
  return style===ORIGINAL_RIG_STYLE ? PREWARM : NO_PREWARM;
}

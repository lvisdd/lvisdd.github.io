import {threeHeightSpearDisplayTip} from './three-height-spear-pose.js';
// A non-contact render frame. Active weapon/contact positions always stay exact.
export function threeHitThrustDisplayTip(pose) {
  const stageTip=threeHeightSpearDisplayTip(pose);if(stageTip)return stageTip;
  const f=pose?.thrustPresentationFrame,p=pose?.attackPresentation;
  if(!pose?.hero||!f||!p||p.enabled!==true||p.version!=='ground-combo-v2'||p.action!=='thrust'||(p.stage!==2&&p.stage!==3)||f.stage!==p.stage||f.actorId!==pose.id||f.actorId!==p.actorId||!Number.isInteger(p.actionSerial)||p.actionSerial<1||f.actionSerial!==p.actionSerial)return pose;
  const clock=pose.thrustTiming;
  if(!clock||clock.profile!=='three-hit-thrust-v1'||clock.profile!==f.timingProfile||clock.actorId!==f.actorId||clock.stage!==f.stage||clock.actionCount!==f.actionCount||clock.actionCount!==p.actionCount||!Number.isFinite(clock.elapsed)||!Number.isFinite(clock.canonicalElapsed)||!Number.isFinite(f.actualElapsed)||Math.abs(clock.elapsed-f.actualElapsed)>1e-8||Math.abs(clock.canonicalElapsed-pose.elapsed)>1e-8)return pose;
  const elapsed=pose.elapsed;
  if(!Number.isFinite(elapsed)||!Number.isFinite(f.elapsed)||elapsed<0||elapsed>.4||elapsed>=.155&&elapsed<=.275||Math.abs(f.elapsed-elapsed)>1e-8)return pose;
  const source=f.authoritativeTip,shown=f.displayTip,grip=pose.grip;
  if(!source||!shown||!grip||!['x','y','z'].every(k=>Number.isFinite(source[k])&&Number.isFinite(shown[k])&&Number.isFinite(grip[k])&&Math.abs(source[k]-pose[k])<1e-7))return pose;
  // A chamber rotates the fixed pole about the supported palm. No extra grip
  // sliding or blade-length change is accepted by this rendering boundary.
  const a=Math.hypot(source.x-grip.x,source.y-grip.y,source.z-grip.z),b=Math.hypot(shown.x-grip.x,shown.y-grip.y,shown.z-grip.z);
  if(a<1e-6||a>3.6||Math.abs(a-b)>1e-5)return pose;
  return shown;
}

// Shared authored practice boards used by the game and its menu preview.
// Rectangle coordinates are actor-center limits, not decorative outer edges.
import {createRecruitLesson} from './recruit-lesson.js';
const spec=(piece,arena,note)=>Object.freeze({piece,arena:Object.freeze(arena),note});
export const COMPACT_LESSON_BOARDS=Object.freeze({
 duel:spec('pawn',{minX:-4,maxX:4,minZ:2,maxZ:17},'Hero (0,14); target (0,5); legal forward approach and thrust.'),
 thrust_trial:spec('pawn',{minX:-4,maxX:4,minZ:2,maxZ:17},'Hero (0,14); non-attacking pawn (0,11), silver (0,8), gold (0,5); three forward thrusts against actual distinct pieces. The lesson-specific trainingTarget flag suppresses attack initiation without a timer; native hits, shoves and recovery remain.'),
 slash_trial:spec('king',{minX:-5,maxX:5,minZ:8,maxZ:17},'Hero (0,14); silver (-1.4,11.7), pawn (0,11.7), gold (1.4,11.7); one sweep against actual distinct pieces.'),
 charge_trial:spec('rook',{minX:-4,maxX:9,minZ:2,maxZ:17},'Hero (0,14); protected ally (0,11); targets (0,6), (5,6); route around the guard, then two cardinal charges.'),
 jump_trial:spec('knight',{minX:-6,maxX:6,minZ:5,maxZ:17},'Hero (0,14); protected allies (-3,11), (0,11), (3,11); target/landing (3,8). Wrong-side landing (-3,8) remains legal and retry remains needed.'),
 guard_trial:spec('king',{minX:-4,maxX:4,minZ:7,maxZ:17},'Hero (0,14); pawn (0,11). A real incoming thrust must be blocked; defeating the pawn is not completion.'),
 awaken_trial:spec('pawn',{minX:-5,maxX:5,minZ:0,maxZ:17},'Hero (0,14); pawn (3,2). Enter z<=7, awaken automatically after the committed action, then use the new slash to hit the off-axis target.'),
 switch_trial:spec('king',{minX:-5,maxX:5,minZ:7,maxZ:17},'Hero king (0,14); allied gold (2,11); non-attacking pawn (2,8). Switch to gold and personally defeat pawn. Wrong owner kill offers retry.'),
 squad:spec('king',{minX:-13.2,maxX:13.2,minZ:.2,maxZ:29.8},'Hero (0,18); pawn (0,15), rook (0,10.2). Canonical pawn slots (0,7)/(0,23), rook (-10.2,3.2)/(10.2,26.8) remain untouched; objective is an actual recruited ally hit.')
});
export function createCompactLesson(E,seed,lesson){
 if(!Object.prototype.hasOwnProperty.call(COMPACT_LESSON_BOARDS,lesson))throw new RangeError('Unknown compact lesson');
 const {piece,arena}=COMPACT_LESSON_BOARDS[lesson];
 return lesson==='squad'?createRecruitLesson(E,seed,{arena}):E.create(seed,piece,'initial',{scenario:lesson,formationHero:true,terrain:'plain',difficulty:'normal',arena});
}

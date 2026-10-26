import * as THREE from './vendor/three.module.min.js';
import {swordComboPhrase} from './sword-combo-motion.js';
/** A small blade-following speed ribbon. Its samples are real hand/edge poses,
 * not a new attack sector. It never extends beyond the held blade's real tip.
 * The existing wave remains separately visible at its exact engine geometry.
 */
export function createSwordComboEffects(scene) {
  const capacity=12,geometry=new THREE.BufferGeometry(),positions=new Float32Array((capacity-1)*18),colors=new Float32Array((capacity-1)*18);
  geometry.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('color',new THREE.BufferAttribute(colors,3).setUsage(THREE.DynamicDrawUsage));geometry.setDrawRange(0,0);
  const material=new THREE.MeshBasicMaterial({color:0xffffff,vertexColors:true,transparent:true,opacity:.64,depthWrite:false,depthTest:true,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,toneMapped:false});
  const ribbon=new THREE.Mesh(geometry,material);ribbon.name='three-stage-blade-ribbon';ribbon.frustumCulled=false;ribbon.visible=false;scene.add(ribbon);
  const tubeGeometry=()=>{const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(new Float32Array((capacity-1)*72),3).setUsage(THREE.DynamicDrawUsage));g.setAttribute('color',new THREE.BufferAttribute(new Float32Array((capacity-1)*72),3).setUsage(THREE.DynamicDrawUsage));g.setDrawRange(0,0);return g;};
  const outlineGeometry=tubeGeometry(),lineGeometry=tubeGeometry();
  const outline=new THREE.Mesh(outlineGeometry,new THREE.MeshBasicMaterial({color:'#153945',transparent:true,opacity:.86,depthWrite:false,depthTest:true,side:THREE.DoubleSide,toneMapped:false})),line=new THREE.Mesh(lineGeometry,new THREE.MeshBasicMaterial({color:0xffffff,vertexColors:true,transparent:true,opacity:.95,depthWrite:false,depthTest:true,side:THREE.DoubleSide,toneMapped:false}));
  outline.name='three-stage-blade-outline';line.name='three-stage-blade-edge';outline.renderOrder=5;line.renderOrder=6;outline.frustumCulled=line.frustumCulled=false;outline.visible=line.visible=false;scene.add(outline,line);
  const lineAxis=new THREE.Vector3(),side=new THREE.Vector3(),normal=new THREE.Vector3(),point=new THREE.Vector3(),worldUp=new THREE.Vector3(0,1,0);
  function tube(g,radius,t){let vertex=0;const positions=g.attributes.position.array,colors=g.attributes.color.array;for(let i=1;i<history.length;i++){const a=history[i-1],b=history[i];lineAxis.copy(b.far).sub(a.far);if(lineAxis.lengthSq()<1e-12)continue;lineAxis.normalize();side.crossVectors(lineAxis,worldUp);if(side.lengthSq()<1e-10)side.set(1,0,0);side.normalize();normal.crossVectors(lineAxis,side).normalize();for(let face=0;face<4;face++)for(const [sample,corner]of[[a,face],[a,face+1],[b,face+1],[a,face],[b,face+1],[b,face]]){const angle=corner*Math.PI/2;point.copy(sample.far).addScaledVector(side,Math.cos(angle)*radius).addScaledVector(normal,Math.sin(angle)*radius);point.toArray(positions,vertex*3);const fade=Math.max(.15,1-(t-sample.t)/.095);colors[vertex*3]=tint.r*fade;colors[vertex*3+1]=tint.g*fade;colors[vertex*3+2]=tint.b*fade;vertex++;}}g.attributes.position.needsUpdate=g.attributes.color.needsUpdate=true;g.setDrawRange(0,vertex);}
  const axis=new THREE.Vector3(),near=new THREE.Vector3(),far=new THREE.Vector3(),tint=new THREE.Color();
  let history=[],identity=null,held=null,historyActorX=0,historyActorZ=0;const stages=new Map();
  function reset(){history=[];identity=null;held=null;stages.clear();ribbon.visible=outline.visible=line.visible=false;geometry.setDrawRange(0,0);lineGeometry.setDrawRange(0,0);outlineGeometry.setDrawRange(0,0);}
  function update({swordCombo=null,waves=[],quiet=false,dt=0}){
    const live=new Set(waves.map(w=>w.id));for(const id of stages.keys())if(!live.has(id))stages.delete(id);
    const s=swordCombo,validAnchors=!!(s?.handBase?.isVector3&&s?.handTip?.isVector3&&[s.actorX,s.actorZ,...s.handBase.toArray(),...s.handTip.toArray()].every(Number.isFinite));let p=s?.presentation,phrase=s?.mode==='sweep'&&p?.actorId===s.actorId&&validAnchors?swordComboPhrase(p,s.phase):null;
    // A paused redraw can clear queued input without advancing the held pose.
    // Keep that exact visual frame; real cancellation, control/life changes and
    // any advancing sample clear this narrow freeze immediately.
    if(!phrase&&validAnchors&&dt===0&&s?.mode==='sweep'&&held&&s.actorId===held.actorId&&s.phase===held.phase&&s.handBase?.distanceToSquared(held.base)<1e-16&&s.handTip?.distanceToSquared(held.tip)<1e-16){p=held.presentation;phrase=held.phrase;}
    else if(phrase)held={actorId:s.actorId,phase:s.phase,presentation:p,phrase,base:s.handBase?.clone(),tip:s.handTip?.clone()};else held=null;
    // The blade is summoned after the palm leaves its resting hip contact,
    // and fades during the supported return, before the source idle pose.
    // Guard release uses the unarmed part of the existing windup to draw.
    // Never gate the live cut/wave, even for a malformed late handoff sample.
    const nativeElapsed = s?.mode === 'sweep' && Number.isFinite(s.phase) ? .46 - s.phase : null;
    const guardDraw = nativeElapsed !== null && nativeElapsed >= 0 && nativeElapsed < .125 && Number.isFinite(s?.guardSwordOpacity)
      ? THREE.MathUtils.clamp(s.guardSwordOpacity,0,1) : 1;
    const bladeOpacity = (phrase ? phrase.opacity : 1) * guardDraw;
    s?.sword?.traverse(node=>{if(node.isMesh&&Number.isFinite(node.material?.userData?.baseOpacity))node.material.opacity=node.material.userData.baseOpacity*bladeOpacity;});
    if(s?.sword&&bladeOpacity<=1e-8)s.sword.visible=false;
    if(phrase){
      // Match only the newly released personal wave from this accepted action.
      // An older flying slash cannot inherit the next action's stage.
      const age=phrase.elapsed-.19;
      if(age>=-1e-8)for(const w of waves)if(w.kind==='slash'&&w.personal===true&&w.sourceId===p.actorId&&w.age>=0&&Math.abs(w.age-age)<.025&&!stages.has(w.id))stages.set(w.id,{stage:phrase.stage,sourceId:p.actorId});
    }
    ribbon.visible=outline.visible=line.visible=false;geometry.setDrawRange(0,0);lineGeometry.setDrawRange(0,0);outlineGeometry.setDrawRange(0,0);
    if(!phrase||quiet||!s.handBase||!s.handTip){history=[];identity=null;return;}
    const key=[p.version,p.actorId,p.actionSerial,p.actionCount,p.stage].join(':');if(key!==identity){history=[];identity=key;}
    // The blade ribbon describes the actor's swing, not a free-flying hitbox.
    // Keep past blade samples in the actor's translating frame so walking does
    // not drag the old ribbon back through the moving body. The independent
    // engine-owned crescent below retains its world-space flight unchanged.
    if(history.length){const x=s.actorX-historyActorX,z=s.actorZ-historyActorZ;for(const sample of history){sample.near.x+=x;sample.near.z+=z;sample.far.x+=x;sample.far.z+=z;}}
    historyActorX=s.actorX;historyActorZ=s.actorZ;
    const t=phrase.elapsed;
    if(t<.155||t>.355){history=[];return;}
    axis.copy(s.handTip).sub(s.handBase);if(axis.lengthSq()<1e-12){history=[];return;}axis.normalize();
    near.copy(s.handBase).addScaledVector(axis,phrase.stage===3?1.55:1.74);far.copy(s.handBase).addScaledVector(axis,1.955);
    // The origin is engine-owned. A malformed anchor cannot create a far trail.
    const radialLimit=3.2-(phrase.stage===3?.085:.065),inside=point=>Math.hypot(point.x-s.actorX,point.z-s.actorZ)<=radialLimit;
    if(![s.actorX,s.actorZ,...near.toArray(),...far.toArray()].every(Number.isFinite)||!inside(near)||!inside(far)){history=[];return;}
    if(!history.length||t>history.at(-1).t+1e-8)history.push({t,near:near.clone(),far:far.clone()});
    history=history.filter(v=>t-v.t<.095&&inside(v.near)&&inside(v.far)).slice(-capacity);if(history.length<2)return;
    tint.set(phrase.stage===3?'#fff0a9':phrase.stage===2?'#95faff':'#c4eaff');
    let vertex=0;for(let i=1;i<history.length;i++){
      const a=history[i-1],b=history[i];
      for(const [point,sample,edge]of[[a.near,a,.30],[a.far,a,1],[b.far,b,1],[a.near,a,.30],[b.far,b,1],[b.near,b,.30]]){
        const strength=Math.max(0,1-(t-sample.t)/.095)*edge;point.toArray(positions,vertex*3);colors[vertex*3]=tint.r*strength;colors[vertex*3+1]=tint.g*strength;colors[vertex*3+2]=tint.b*strength;vertex++;
      }
    }
    tube(outlineGeometry,phrase.stage===3?.085:.065,t);tube(lineGeometry,phrase.stage===3?.050:.035,t);outline.visible=line.visible=true;outline.material.opacity=.80*(1-THREE.MathUtils.smoothstep(t,.300,.355));line.material.opacity=.95*(1-THREE.MathUtils.smoothstep(t,.300,.355));
    material.opacity=(phrase.stage===3?.56:.38)*(1-THREE.MathUtils.smoothstep(t,.300,.355));
    geometry.attributes.position.needsUpdate=geometry.attributes.color.needsUpdate=true;geometry.setDrawRange(0,vertex);ribbon.visible=material.opacity>0;
  }
  function waveStyle(w){const p=stages.get(w.id);return p&&w.kind==='slash'&&w.personal===true&&w.sourceId===p.sourceId?p.stage:0;}
  return {reset,update,waveStyle};
}

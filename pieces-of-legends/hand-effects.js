import {createContactHeadBounds} from './contact-head-bounds.js';
import {createSwordComboEffects} from './sword-combo-effects.js';
import {threeHitThrustDisplayTip} from './three-hit-thrust-frame.js';
import * as THREE from './vendor/three.module.min.js';
import {createWeaponAccents} from './weapon-accents.js';
import {createSpearTrails,createSpearTipVisibility} from './spear-trails.js';

// Geometry reads exactly the same wave positions, radii, sector and half-depth
// used by BattleEngine.waveHitsBody. Decorative glow never adds a hitbox.
export function createHandEffects(scene,{models=null}={}) {
  const headBounds=models?createContactHeadBounds(models):null;let contactHeadsPrepared=false;
  const accents=createWeaponAccents(THREE),heroAccents=createWeaponAccents(THREE,{presentationOwner:'hero'}),spearTrails=createSpearTrails(THREE,scene),swordComboEffects=createSwordComboEffects(scene);
  const MAX=32, sector=new THREE.Shape(), start=-Math.PI*.78, length=Math.PI*1.56;
  sector.moveTo(Math.cos(start),Math.sin(start));sector.absarc(0,0,1,start,start+length,false);
  sector.lineTo(.7*Math.cos(start+length),.7*Math.sin(start+length));sector.absarc(0,0,.7,start+length,start,true);sector.closePath();
  const profileCache=new Map();let crescentGeo=new THREE.ExtrudeGeometry(sector,{depth:2,steps:1,bevelEnabled:false,curveSegments:32});crescentGeo.translate(0,0,-1);
  const sphereGeo=new THREE.SphereGeometry(1,20,12), frameGeo=new THREE.RingGeometry(.94,1,40);
  const basic=(color,opacity)=>new THREE.MeshBasicMaterial({color,opacity,transparent:true,side:THREE.DoubleSide,depthWrite:false,blending:THREE.AdditiveBlending});
  const horizontal=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),Math.PI/2);
 const forward=new THREE.Vector3(0,0,1),direction=new THREE.Vector3(),dummy=new THREE.Object3D(),color=new THREE.Color();
  const pool=Array.from({length:MAX},()=>{
    const group=new THREE.Group(),core=new THREE.Mesh(crescentGeo,basic('#dcfcff',.72)),glow=new THREE.Mesh(crescentGeo,basic('#20cfff',.28));glow.scale.setScalar(1.045);
    const pulse=new THREE.Mesh(sphereGeo,basic('#4fe4ff',.2)),frame=new THREE.Mesh(frameGeo,basic('#e7fdff',.8)),ripple=new THREE.Mesh(new THREE.RingGeometry(.63,.67,36),basic('#a0f4ff',.45));
    const spear=accents.createSpear('#45dfff');group.add(spear);const landing=accents.createLanding('#45dfff');landing.visible=false;scene.add(landing);group.add(core,glow,pulse,frame,ripple);group.visible=false;scene.add(group);return {group,core,glow,pulse,frame,ripple,spear,landing};
  });
  const heldSpears=Array.from({length:41},(_,i)=>{const mesh=accents.createHeldSpear('#45dfff');mesh.name='held-thrust-'+i;mesh.visible=false;mesh.userData.fadeMaterials=[];mesh.traverse(node=>{if(node.isMesh){node.material.transparent=true;mesh.userData.fadeMaterials.push(node.material);}});scene.add(mesh);return mesh;});
  const chargeSpears=Array.from({length:32},(_,i)=>{const mesh=accents.createHeldSpear('#45dfff');mesh.name='held-charge-'+i;mesh.visible=false;scene.add(mesh);return mesh;});
  const tipVisibility=createSpearTipVisibility(THREE,scene,heldSpears[0].getObjectByName('held-head').geometry,heldSpears[0].getObjectByName('held-shaft'));
  // The controlled body owns one immutable short-pole profile. NPC pool geometry
  // and capacity stay unchanged; control switching never relies on an actor ID.
  const heroThrust=heroAccents.createHeldSpear('#45dfff'),heroCharge=heroAccents.createHeldSpear('#45dfff');
  heroThrust.name='held-thrust-hero';heroCharge.name='held-charge-hero';
  heroThrust.visible=heroCharge.visible=false;heroThrust.userData.fadeMaterials=[];
  heroThrust.traverse(node=>{if(node.isMesh){node.material.transparent=true;heroThrust.userData.fadeMaterials.push(node.material);}});
  scene.add(heroThrust,heroCharge);
  // Six lightweight skeletal owners reuse the accepted short spear. Static LOD
  // keeps its original long-pole socket; no extra skeletons or per-frame meshes.
  const npcRigSpears=Array.from({length:6},(_,i)=>{const mesh=heroAccents.createHeldSpear('#45dfff');mesh.name='held-npc-rig-'+i;mesh.visible=false;mesh.userData.fadeMaterials=[];mesh.traverse(node=>{if(node.isMesh){node.material.transparent=true;mesh.userData.fadeMaterials.push(node.material);}});scene.add(mesh);return mesh;});
  const npcRigTipVisibility=createSpearTipVisibility(THREE,scene,npcRigSpears[0].getObjectByName('held-head').geometry,npcRigSpears[0].getObjectByName('held-shaft'),{capacity:6,name:'npc-rig-spear-outlines'});
  const heroTipVisibility=createSpearTipVisibility(THREE,scene,heroThrust.getObjectByName('held-head').geometry,heroThrust.getObjectByName('held-shaft'),{capacity:1,name:'hero-spear-outlines'});
  const grip=new THREE.Vector3(),tip=new THREE.Vector3();
  const contactRay=new THREE.Ray(),contactDirection=new THREE.Vector3(),contactCenter=new THREE.Vector3(),contactIntersection=new THREE.Vector3(),contactBody=new THREE.Sphere();
  function contactCenterOccluded(item,cameraPosition,actors){
    // An open, depth-tested thrust rim is occluded fragment by fragment. Do
    // not discard its still-visible outer edge only because its center is hidden.
    // All charge overlay identity/head checks and quiet contact checks remain.
    if(item.depthTestedBurst)return false;
    if(!item.thrustContact&&!item.charge)return false;
    if(!Number.isInteger(item.targetId)||!cameraPosition)return item.charge;
    // Charge keeps a complete mark on its actual target only when that target
    // is still the same actor. Missing/replaced/revived identities fail closed;
    // the next hit or reset clears the binding. Never fall back to an old ID.
    if(item.charge){
      if(item.invalidTarget||!Number.isFinite(cameraPosition.x)||!Number.isFinite(cameraPosition.y)||!Number.isFinite(cameraPosition.z))return true;
      let target=null;for(const actor of actors||[])if(actor.id===item.targetId){if(target){item.invalidTarget=true;return true;}target=actor;}
      if(!target||!Number.isFinite(target.x)||!Number.isFinite(target.z)||(target.y!==undefined&&!Number.isFinite(target.y))||(target.alive===false&&target.age>2.4)||(item.targetRef&&item.targetRef!==target)||(item.targetWasDead&&target.alive!==false)){item.invalidTarget=true;return true;}
      item.targetRef=target;item.targetWasDead=target.alive===false;
    }
    contactDirection.copy(cameraPosition).sub(item.ground.position);const distance=contactDirection.length();if(distance<1e-6)return false;contactDirection.divideScalar(distance);contactRay.set(item.ground.position,contactDirection);
    for(const actor of actors||[]){
      if(actor.id===item.targetId)continue;
      if(actor.alive===false){
        if(!item.charge||actor.age>2.4)continue;
        // battle.js rotates fallen bodies about their half-height pivot and
        // shrinks them after 1.7 seconds. Visible non-target corpses still
        // occlude a charge confirmation; only its own struck target is exempt.
        const age=Number.isFinite(actor.age)?actor.age:0,lifeScale=age<1.7?1:Math.max(.001,(2.4-age)/.7);
        contactCenter.set(actor.x,(actor.y||0)+1.9*lifeScale,actor.z);contactBody.set(contactCenter,2.25*lifeScale);
        if(contactRay.intersectSphere(contactBody,contactIntersection)&&contactIntersection.distanceTo(item.ground.position)<distance)return true;
        continue;
      }
      // Same conservative upper-body envelope used by spear visibility. A
      // hidden center must not leave rays suggesting a hit on the foreground
      // actor. The actual target is excluded; the hit point is never moved.
      contactCenter.set(actor.x+(actor.dx||0)*.55,(actor.y||0)+2.55,actor.z+(actor.dz||0)*.55);contactBody.set(contactCenter,1.12);
      if(contactRay.intersectSphere(contactBody,contactIntersection)&&contactIntersection.distanceTo(item.ground.position)<distance)return true;
    }
    return false;
  }
  // Compare the actual contact triangles with model-derived head silhouettes.
  // Only charge overlays need this extra check; ordinary depth-tested effects
  // remain untouched. Fixed buffers avoid per-frame geometry/array allocation.
  const headViewPoint=new THREE.Vector3(),headViewRotation=new THREE.Quaternion(),contactVertices=new Float64Array(1536);
  function triangleMeetsRect(a,b,c,minX,minY,maxX,maxY){
    const ax=contactVertices[a],ay=contactVertices[a+1],bx=contactVertices[b],by=contactVertices[b+1],cx=contactVertices[c],cy=contactVertices[c+1];
    if(Math.max(ax,bx,cx)<minX||Math.min(ax,bx,cx)>maxX||Math.max(ay,by,cy)<minY||Math.min(ay,by,cy)>maxY)return false;
    const midX=(minX+maxX)/2,midY=(minY+maxY)/2,halfX=(maxX-minX)/2,halfY=(maxY-minY)/2;
    for(let edge=0;edge<3;edge++){
      const x0=edge===0?ax:edge===1?bx:cx,y0=edge===0?ay:edge===1?by:cy,x1=edge===0?bx:edge===1?cx:ax,y1=edge===0?by:edge===1?cy:ay,nx=y0-y1,ny=x1-x0;
      const ta=ax*nx+ay*ny,tb=bx*nx+by*ny,tc=cx*nx+cy*ny,center=midX*nx+midY*ny,radius=halfX*Math.abs(nx)+halfY*Math.abs(ny);
      if(Math.max(ta,tb,tc)<center-radius||Math.min(ta,tb,tc)>center+radius)return false;
    }
    return true;
  }
  function contactHeadOccluded(item,cameraPosition,cameraQuaternion){
    if(!item.charge||!headBounds)return false;
    if(!contactHeadsPrepared||!headBounds.ready||!cameraPosition||!cameraQuaternion)return true;
    headViewRotation.copy(cameraQuaternion).invert();
    headViewPoint.copy(item.ground.position).sub(cameraPosition).applyQuaternion(headViewRotation);const contactDepth=-headViewPoint.z;if(!(contactDepth>0))return true;
    let count=0;
    for(let part=0;part<2;part++){
      const mesh=part?item.flash:item.ground;if(!mesh.visible||mesh.material.opacity<=0)continue;
      const positions=mesh.geometry.attributes.position,index=mesh.geometry.index,length=index?index.count:positions.count;
      if(count+length>512)return true;
      for(let v=0;v<length;v++){
        headViewPoint.fromBufferAttribute(positions,index?index.getX(v):v).multiply(mesh.scale).applyQuaternion(mesh.quaternion).add(mesh.position).sub(cameraPosition).applyQuaternion(headViewRotation);
        const depth=-headViewPoint.z;if(!(depth>0))return true;const offset=3*count++;contactVertices[offset]=headViewPoint.x/depth;contactVertices[offset+1]=headViewPoint.y/depth;contactVertices[offset+2]=depth;
      }
    }
    for(let h=0;h<headBounds.count;h++){
      const entry=headBounds.entries[h];if(entry.id===item.targetId)continue;
      const box=entry.box;let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity,near=Infinity,far=-Infinity;
      for(let corner=0;corner<8;corner++){
        headViewPoint.set(corner&1?box.max.x:box.min.x,corner&2?box.max.y:box.min.y,corner&4?box.max.z:box.min.z).sub(cameraPosition).applyQuaternion(headViewRotation);
        const depth=-headViewPoint.z;near=Math.min(near,depth);far=Math.max(far,depth);const divisor=Math.max(.00001,depth),x=headViewPoint.x/divisor,y=headViewPoint.y/divisor;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
      }
      // A head entirely behind the contact billboard cannot be painted through.
      if(far<=0||near>=contactDepth+.004)continue;
      for(let vertex=0;vertex+2<count;vertex+=3)if(triangleMeetsRect(vertex*3,(vertex+1)*3,(vertex+2)*3,minX,minY,maxX,maxY))return true;
    }
    return false;
  }
  // Extra actors near the contact can make an open rim read as a second hit.
  // The largest finisher radius is 1.83 * 1.30 = 2.379; add the existing
  // 1.12 upper-body envelope and round up to 3.5. Only the cosmetic rim
  // shrinks; neither the real contact nor any attack range moves.
  // Once reduced, a cue cannot grow back when neighbors move away.
  function fitThrustBurst(item,actors){
    let target=null;
    for(const actor of actors||[])if(actor.id===item.targetId){if(target)return item.burstFit=0;target=actor;}
    if(!target||!Number.isFinite(target.x)||!Number.isFinite(target.z)||(item.targetRef&&item.targetRef!==target)||(item.targetWasDead&&target.alive!==false))return item.burstFit=0;
    item.targetRef=target;item.targetWasDead=target.alive===false;
    if(!item.sourceBound){
      for(const actor of actors||[])if(actor.id===item.sourceId){if(item.sourceRef){item.sourceRef=null;break;}item.sourceRef=actor;}
      item.sourceBound=true;
    }
    let fit=item.burstFit??1;
    for(const actor of actors||[]){
      if(actor===target||actor===item.sourceRef||actor.alive===false)continue;
      if(Math.hypot(actor.x-item.ground.position.x,actor.z-item.ground.position.z)<3.5)fit=Math.min(fit,.28);
    }
    return item.burstFit=fit;
  }
  function beginContactHeads(heroId,heroVisible){contactHeadsPrepared=false;if(!headBounds)return false;for(const item of impacts)if(item.charge&&item.age<item.life){contactHeadsPrepared=true;break;}headBounds.begin(contactHeadsPrepared,heroId,heroVisible);return contactHeadsPrepared;}
  function addContactHead(actor,matrix,slot){headBounds?.addNpc(actor,matrix,slot);}
  // Keep the leaf blade upright at every actor yaw. Shortest-arc rotation
  // around +Z lets an asymmetric spearhead roll when facing backwards.

  const afterimages=Array.from({length:7},()=>{const mesh=new THREE.Mesh(frameGeo,basic('#91eaff',.35));mesh.visible=false;scene.add(mesh);return {mesh,age:1};});
  const promotion=new THREE.Mesh(new THREE.RingGeometry(1,2,72),basic('#ffe29a',.8));promotion.rotation.x=-Math.PI/2;promotion.visible=false;scene.add(promotion);const promotionWall=new THREE.Mesh(new THREE.CylinderGeometry(1,1,1,72,1,true),basic('#ffd976',.12));promotionWall.visible=false;scene.add(promotionWall);
  let nextAfter=0,afterTimer=0;
  const telegraphs=new THREE.InstancedMesh(new THREE.RingGeometry(.95,1.1,32),new THREE.MeshBasicMaterial({color:'#ffffff',transparent:true,opacity:.8,side:THREE.DoubleSide,depthWrite:false}),60);
  const arrows=new THREE.InstancedMesh(new THREE.PlaneGeometry(.14,2.5),new THREE.MeshBasicMaterial({color:'#ffffff',transparent:true,opacity:.7,side:THREE.DoubleSide,depthWrite:false}),60);
  telegraphs.frustumCulled=arrows.frustumCulled=false;scene.add(telegraphs,arrows);
  const lanes=new THREE.InstancedMesh(new THREE.PlaneGeometry(3.7,8.23),new THREE.MeshBasicMaterial({color:'#ffffff',transparent:true,opacity:.2,side:THREE.DoubleSide,depthWrite:false}),60);const landWarnings=new THREE.InstancedMesh(new THREE.RingGeometry(3.15,3.4,40),new THREE.MeshBasicMaterial({color:'#ffffff',transparent:true,opacity:.65,side:THREE.DoubleSide,depthWrite:false}),60);lanes.name='attack-warning-lanes';landWarnings.name='jump-warning-landings';lanes.frustumCulled=landWarnings.frustumCulled=false;scene.add(lanes,landWarnings);
  const CHIP_COUNT=224,SPARK_COUNT=128,chipData=Array(CHIP_COUNT),sparkData=Array(SPARK_COUNT);
  const chips=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial({color:'#fff1d4',roughness:.9,metalness:0}),CHIP_COUNT);
  const sparks=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),basic('#ffffff',.9),SPARK_COUNT);
  chips.frustumCulled=sparks.frustumCulled=false;chips.instanceMatrix.setUsage(THREE.DynamicDrawUsage);sparks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);scene.add(chips,sparks);
  let chipIndex=0,sparkIndex=0,seed=319;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  // Two meshes per existing slot: replace the tiny body-occluded ring with a
  // compact outlined contact mark. No new scene nodes or per-hit geometries.
  const impactGroundGeo=new THREE.RingGeometry(.78,1,32),impactRingGeo=new THREE.RingGeometry(.82,1,32),legacyImpactRingGeo=new THREE.RingGeometry(.4,1,24);
  function contactStar(){
    const shape=new THREE.Shape();
    for(let i=0;i<16;i++){const a=i*Math.PI/8,r=i%4===0?1:i%2===0?.48:.24,x=Math.cos(a)*r,y=Math.sin(a)*r;if(i===0)shape.moveTo(x,y);else shape.lineTo(x,y);}shape.closePath();
    const base=new THREE.ShapeGeometry(shape),positions=[],colors=[],pos=base.attributes.position,indices=base.index?.array||Array.from({length:pos.count},(_,i)=>i);
    // Dark edge and pale center in one immutable geometry. Both draw locally
    // over the target body; never a full-screen flash or additional render pass.
    for(const [size,z,tone] of [[1,0,'#173444'],[.78,.002,'#effdff']]){const c=new THREE.Color(tone);for(const index of indices){positions.push(pos.getX(index)*size,pos.getY(index)*size,z);colors.push(c.r,c.g,c.b);}}
    base.dispose();const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));return geo;
  }
  // Stage-three confirmation stays centered on the engine's real contact.
  // A cut-crystal star and paired side glints share the existing two meshes;
  // their immutable local geometry never suggests a larger damaging radius.
  function finisherGeometry(glints=false){
    const shapes=glints?
      [[[-1.03,-.23],[-.79,-.17],[-.65,.03],[-.76,-.25],[-.67,-.45],[-.90,-.33]],[[1.03,.23],[.79,.17],[.65,-.03],[.76,.25],[.67,.45],[.90,.33]]]:
      [[[0,1.12],[.13,.20],[.76,0],[.13,-.20],[0,-1.12],[-.13,-.20],[-.76,0],[-.13,.20]]];
    const positions=[],colors=[];
    for(const points of shapes){
      const shape=new THREE.Shape(points.map(([x,y])=>new THREE.Vector2(x,y))),base=new THREE.ShapeGeometry(shape),pos=base.attributes.position,indices=base.index?.array||Array.from({length:pos.count},(_,i)=>i);
      const center=glints?points.reduce((a,p)=>[a[0]+p[0]/points.length,a[1]+p[1]/points.length],[0,0]):[0,0];
      for(const [size,z,tone] of [[1,0,'#153843'],[.77,.002,glints?'#ffe9a3':'#fffdf0']]){const c=new THREE.Color(tone);for(const index of indices){positions.push(center[0]+(pos.getX(index)-center[0])*size,center[1]+(pos.getY(index)-center[1])*size,z);colors.push(c.r,c.g,c.b);}}
      base.dispose();
    }
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));return geo;
  }
  // A confirmed thrust has an open-center, broken-rim impact. It stays at
  // the engine contact, has a short attack then contracts and remains depth
  // tested. The rim can peek around a target without painting through bodies.
  // One immutable geometry reuses the existing impact slot; quiet keeps its star.
  function spearImpactGeometry(){
    const positions=[],colors=[];
    const polygon=points=>{
      const center=points.reduce((a,p)=>[a[0]+p[0]/points.length,a[1]+p[1]/points.length],[0,0]);
      for(const [size,z,tone] of [[1,0,'#d5e8ef'],[.57,.002,'#fff9df']]){
        const c=new THREE.Color(tone);
        for(let j=1;j+1<points.length;j++)for(const k of [0,j,j+1]){const p=points[k];positions.push(center[0]+(p[0]-center[0])*size,center[1]+(p[1]-center[1])*size,z);colors.push(c.r,c.g,c.b);}
      }
    };
    const point=(a,r)=>[Math.cos(a)*r,Math.sin(a)*r];
    // Three unequal broken arcs and six unequal rays read as a quick impact,
    // not a lock-on reticle. All are centered on the actual confirmed contact.
    for(const [start,end,r] of [[17,48,1.52],[135,173,1.40],[237,270,1.28]]){
      for(let j=0;j<2;j++){const a=(start+(end-start)*j/2)*Math.PI/180,b=(start+(end-start)*(j+1)/2)*Math.PI/180;
        polygon([point(a,r-.075),point(b,r-.075),point(b,r),point(a,r)]);
      }
    }
    for(const [angle,inner,outer,width] of [[-5,.70,1.76,.045],[38,.68,1.32,.038],[102,.88,1.52,.030],[154,.75,1.83,.043],[218,.86,1.39,.037],[293,.73,1.65,.033]]){
      const a=angle*Math.PI/180;polygon([point(a-width,inner),point(a,outer),point(a+width,inner)]);
    }
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));return geo;
  }
  const contactGeo=contactStar(),spearImpactGeo=spearImpactGeometry(),finisherGeo=finisherGeometry(),finisherGlintGeo=finisherGeometry(true),guardShape=new THREE.Shape();
  guardShape.moveTo(-.63,.64);guardShape.lineTo(.63,.64);guardShape.lineTo(.58,-.22);guardShape.lineTo(0,-.77);guardShape.lineTo(-.58,-.22);guardShape.closePath();
  const guardHole=new THREE.Path();guardHole.moveTo(-.45,.46);guardHole.lineTo(-.41,-.13);guardHole.lineTo(0,-.53);guardHole.lineTo(.41,-.13);guardHole.lineTo(.45,.46);guardHole.closePath();guardShape.holes.push(guardHole);
  const guardGeo=new THREE.ShapeGeometry(guardShape);
  const impacts=Array.from({length:8},(_,i)=>{const ground=new THREE.Mesh(impactGroundGeo,basic('#37d9ff',.65)),flash=new THREE.Mesh(impactRingGeo,basic('#d8fcff',.9));ground.name='contact-core-'+i;flash.name='contact-ring-'+i;ground.rotation.x=-Math.PI/2;ground.visible=flash.visible=false;scene.add(ground,flash);return {ground,flash,age:1,life:.38,priority:0};});
  let impactIndex=0;
  function hit(x,z,{stone=false,enemy=false,y=1.4,lethal=true,kind='damage',priority=0,compact=false,comboStage=0,targetId=null,sourceId=null,sourceAction=null}={}){
    if(!Number.isFinite(x)||!Number.isFinite(z)||!Number.isFinite(y))return false;
    const guard=kind==='guard',thrust=kind==='thrust',charge=kind==='charge',thrustContact=thrust||sourceAction==='thrust';if(guard||thrust)lethal=false;
    // The bridge supplies stage from the accepted contact's originating wave,
    // not the actor's current combo. Guards and compact block cues never finish.
    const finisher=comboStage===3&&!compact&&(kind==='damage'||thrust||charge);
    // Crowd contacts stay within the original eight slots. Ambient contacts
    // cannot displace the controlled actor's accepted contact in the same burst.
    let item;for(let i=0;i<impacts.length;i++){const slot=impacts[(impactIndex+i)%impacts.length];if(slot.age>=slot.life){item=slot;impactIndex=(impactIndex+i+1)%impacts.length;break;}if(slot.priority<=priority&&(!item||slot.priority<item.priority||slot.priority===item.priority&&slot.age>item.age))item=slot;}
    if(!item)return false;
    item.age=0;item.fresh=true;item.sourceId=sourceId;item.sourceRef=null;item.sourceBound=false;item.targetId=targetId;item.targetRef=null;item.targetWasDead=false;item.invalidTarget=false;item.headFit=1;item.burstFit=1;item.thrustContact=thrustContact;item.compact=compact;item.lethal=lethal;item.guard=guard;item.thrust=thrust;item.charge=charge;item.finisher=finisher;item.priority=priority;item.life=finisher?.25:charge?.23:thrust?.19:compact?.12:lethal?.38:guard?.20:.22;
    // The charge overlay is admitted only by the target/foreground check in
    // update(). A reused slot cannot expose its previous mark before that check.
    if(charge)item.ground.visible=item.flash.visible=false;
    item.ground.geometry=finisher?finisherGeo:charge?contactGeo:lethal?impactGroundGeo:guard?guardGeo:contactGeo;item.flash.geometry=finisher?finisherGlintGeo:thrust||charge?contactGeo:lethal?legacyImpactRingGeo:impactRingGeo;item.ground.position.set(x,lethal&&!finisher&&!charge?.06:y,z);item.flash.position.set(x,y,z);
    const contact=!lethal||finisher||charge;for(const mesh of [item.ground,item.flash]){mesh.material.depthTest=thrustContact||!contact;mesh.material.blending=contact?THREE.NormalBlending:THREE.AdditiveBlending;mesh.renderOrder=contact?8:0;}
    if(item.ground.material.vertexColors!==(contact&&!guard)){item.ground.material.vertexColors=contact&&!guard;item.ground.material.needsUpdate=true;}
    if(item.flash.material.vertexColors!==(thrust||charge||finisher)){item.flash.material.vertexColors=thrust||charge||finisher;item.flash.material.needsUpdate=true;}
    item.ground.material.color.set(finisher?(enemy?'#ffb79b':'#e7fbff'):guard?'#ffe49a':contact?(enemy?'#ff9178':'#9beeff'):(enemy?'#ff563e':'#37d9ff'));item.flash.material.color.set(finisher?(enemy?'#ff9c71':'#fff6d4'):thrust||charge?(enemy?'#ffc39a':'#ddfaff'):contact?(enemy?'#ff624b':'#27d6fa'):(enemy?'#ff8b65':'#d8fcff'));
    if(guard)return true;
    for(let i=0;i<(lethal?16:0);i++){
      const a=random()*Math.PI*2,v=2+random()*5,index=chipIndex++%CHIP_COUNT;
      chipData[index]={x,z,y:.7+random()*.8,vx:Math.cos(a)*v,vz:Math.sin(a)*v,vy:3+random()*5,age:0,fresh:true,life:.45+random()*.35,size:.055+random()*.13,spin:random()*8};
      chips.setColorAt(index,color.set(enemy?'#c57962':stone?(i%2?'#bab7af':'#726f6a'):(i%2?'#b17d3b':'#f1c178')));
    }
    for(let i=0;i<(finisher?12:charge?10:thrust?8:compact?2:lethal?18:8);i++){
      const a=random()*Math.PI*2,v=lethal?3+random()*8:thrust?2.5+random()*2:1+random()*3,index=sparkIndex++%SPARK_COUNT;
      sparkData[index]={x,z,y,vx:Math.cos(a)*v,vz:Math.sin(a)*v,vy:thrust?(random()-.35)*5:(random()-.15)*8,age:0,fresh:true,life:lethal?.16+random()*.22:.10+random()*.07,size:lethal?.045+random()*.07:thrust||charge?.085+random()*.045:.055+random()*.045,spin:random()*6};
      sparks.setColorAt(index,color.set(finisher?(i%3===0?'#fff7cf':enemy?'#ff8b68':'#6cecff'):thrust?(i%2?(enemy?'#ff8c62':'#50e5ff'):'#fff3cf'):enemy?'#ff6952':i%2?'#34dfff':'#bbf7ff'));
    }
    return true;
  }
  function reset(){contactHeadsPrepared=false;headBounds?.begin(false);swordComboEffects.reset();spearTrails.reset();tipVisibility.reset();heroTipVisibility.reset();npcRigTipVisibility.reset();heroThrust.visible=heroCharge.visible=false;for(const spear of chargeSpears)spear.visible=false;for(const spear of npcRigSpears)spear.visible=false;for(const spear of heldSpears)spear.visible=false;promotion.visible=promotionWall.visible=false;for(const p of pool){p.group.visible=false;p.landing.visible=false;}for(const p of afterimages){p.age=1;p.mesh.visible=false;}for(const p of impacts){p.age=1;p.fresh=false;p.targetRef=null;p.targetId=null;p.targetWasDead=false;p.invalidTarget=false;p.headFit=1;p.flash.visible=p.ground.visible=false;}chipData.fill(null);sparkData.fill(null);afterTimer=0;}
  function particles(dt,data,mesh,quiet,spark){
    for(let i=0;i<data.length;i++){const p=data[i],step=p?.fresh?0:dt;if(p){p.fresh=false;p.age+=step;}if(!p||quiet||p.age>p.life){dummy.scale.setScalar(0);}else{p.x+=p.vx*step;p.z+=p.vz*step;p.y+=p.vy*step;p.vy-=(spark?7:18)*step;if(p.y<.04){p.y=.04;p.vy=Math.abs(p.vy)*.15;p.vx*=.88;p.vz*=.88;}const fade=Math.max(0,1-p.age/p.life);dummy.position.set(p.x,p.y,p.z);dummy.rotation.set(p.spin*p.age,i*.71+p.spin*p.age,p.spin*p.age);dummy.scale.set(p.size*fade,spark?p.size*4*fade:p.size*.65*fade,p.size*fade);}dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);}
    mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
  }
  function update({dt,swordCombo=null,waves=[],enemies=[],arena=null,promotionPulse=null,quiet=false,cameraQuaternion,cameraPosition=null,thrusts=[],chargeGrips=null,chargeDisplayTips=null,npcSpearSlots=null,npcChargePreviews=[],chargePreview=null,controlledActorId=null,occluders=enemies,thrustSpec={start:1.1,reach:3.2,right:0,radius:.14}}){
    swordComboEffects.update({swordCombo,waves,quiet,dt});
    spearTrails.reset();tipVisibility.reset(quiet);heroTipVisibility.reset(quiet);npcRigTipVisibility.reset(quiet);heroThrust.visible=heroCharge.visible=false;for(const spear of chargeSpears)spear.visible=false;for(const spear of npcRigSpears)spear.visible=false;
    promotion.visible=promotionWall.visible=!!promotionPulse&&promotionPulse.age>=0;
    if(promotion.visible){const q=promotionPulse,r=q.radius;const pos=promotion.geometry.attributes.position;for(let i=0;i<pos.count;i++){const a=i%73/72*Math.PI*2,rr=i<73?r-q.halfWidth:r+q.halfWidth;pos.setXYZ(i,Math.cos(a)*rr,Math.sin(a)*rr,0);}pos.needsUpdate=true;promotion.geometry.computeBoundingSphere();promotion.position.set(q.x,.12,q.z);promotionWall.position.set(q.x,q.height/2,q.z);promotionWall.scale.set(r+q.halfWidth,q.height,r+q.halfWidth);promotionWall.material.opacity=(quiet?.035:.12)*Math.min(1,(q.life-q.age)/.1);promotion.material.opacity=(quiet?.35:.85)*Math.min(1,(q.life-q.age)/.1);}
    // Summon the complete pole only after continuous arm preparation. It is
    // at full charge-palette intensity before .16 contact and throughout .16–.27.
    // The post-contact fade never shortens the shaft or changes its exact tip.
    for(let i=0;i<heldSpears.length;i++){const pose=thrusts[i];heldSpears[i].visible=false;const rigPole=Number.isInteger(pose?.npcSpearSlot)?npcRigSpears[pose.npcSpearSlot]:null,mesh=pose?.hero?heroThrust:rigPole||heldSpears[i];mesh.visible=!!pose;if(!pose)continue;const shownTip=threeHitThrustDisplayTip(pose);tip.set(shownTip.x,shownTip.y,shownTip.z);if(pose.grip)grip.copy(pose.grip);else grip.set(pose.actorX-pose.dz*.8234+pose.dx*.0833,pose.actorY+1.4094,pose.actorZ+pose.dx*.8234+pose.dz*.0833);(pose.hero||rigPole?heroAccents:accents).placeHeldSpear(mesh,grip,tip,pose.dx,pose.dz);mesh.userData.actorId=pose.id;mesh.userData.contactTip={x:pose.x,y:pose.y,z:pose.z};const elapsed=Number.isFinite(pose.elapsed)?pose.elapsed:.2,fadeIn=THREE.MathUtils.smoothstep(pose.hero&&pose.thrustTiming?.profile==='three-hit-thrust-v1'?pose.thrustTiming.elapsed:elapsed,.06,.11),fadeOut=1-THREE.MathUtils.smoothstep(elapsed,.32,.38),opacity=Math.min(fadeIn,fadeOut);mesh.visible=opacity>0;mesh.userData.thrustOpacity=opacity;for(const material of mesh.userData.fadeMaterials){material.color.setHex(material.userData.role==='core'?(pose.team==='enemy'?0xffcfbb:0xc3f7ff):(pose.team==='enemy'?0xff684f:0x70edff));material.opacity=material.userData.baseOpacity*opacity*(quiet?.65:1);material.depthWrite=false;}
      // Speed, never a hit: begins only at release and stays behind the exact
      // current contact tip, including the three-hit canonical phase clock.
      if(mesh.visible)(pose.hero?heroTipVisibility:rigPole?npcRigTipVisibility:tipVisibility).add(mesh,tip,{id:pose.id,x:pose.actorX,y:pose.actorY,z:pose.actorZ,dx:pose.dx,dz:pose.dz},cameraPosition,occluders,pose.team==='enemy',opacity);
      if(!quiet&&elapsed>=.16&&elapsed<.32){const extension=Math.max(0,(pose.x-pose.actorX)*pose.dx+(pose.z-pose.actorZ)*pose.dz-thrustSpec.start),fade=1-THREE.MathUtils.smoothstep(elapsed,.27,.32);const snap=1-THREE.MathUtils.smoothstep(elapsed,.19,.29);spearTrails.addFromGrip(tip,grip,Math.min(2.1,extension),fade,pose.team==='enemy',1.25+.80*snap);}
    }
    let charge;
    for(let i=0;i<pool.length;i++){
      const slot=pool[i],w=waves[i];slot.group.visible=!!w&&!w.held;slot.landing.visible=false;if(!w||w.held)continue;
      const enemy=w.team==='enemy',slash=w.kind==='slash',isCharge=w.kind==='charge';if(slash&&w.profile){const cacheKey=(w.orientation||'vertical')+':'+(w.profileStage||8);let geometry=profileCache.get(cacheKey);if(!geometry){const shape=new THREE.Shape(w.profile.map(([x,y])=>new THREE.Vector2(x,y)));shape.closePath();geometry=new THREE.ExtrudeGeometry(shape,{depth:2,steps:1,bevelEnabled:false});geometry.translate(0,0,-1);profileCache.set(cacheKey,geometry);}slot.core.geometry=slot.glow.geometry=geometry;}if(isCharge&&!enemy)charge=w;
      const fade=Math.min(1,Math.max(0,(w.life-w.age)/.06)),tone=enemy?'#ff6c48':isCharge?'#8eebff':'#45dfff';
      slot.group.position.set(w.x,w.y,w.z);direction.set(w.dx,0,w.dz);slot.group.quaternion.setFromUnitVectors(forward,direction);
      slot.spear.visible=!slash&&w.kind!=='burst'&&!isCharge;slot.spear.scale.set(w.rx,w.ry,w.rz);slot.spear.traverse(n=>{if(n.isMesh){n.material.color.setHex(n.material.userData.role==='core'?(enemy?0xffcfbb:0xc3f7ff):(enemy?0xff684f:0x70edff));n.material.opacity=n.material.userData.baseOpacity*fade*(quiet?.65:1);}});slot.landing.visible=w.kind==='burst';if(slot.landing.visible){slot.landing.position.set(w.x,.035,w.z);const jolt=quiet?0:Math.sin(w.age*70)*.018*fade;slot.landing.rotation.z=jolt;slot.landing.scale.set(w.rx,1,w.rz);slot.landing.traverse(n=>{if(n.isMesh){n.material.color.set(enemy?'#ff684f':'#65eaff');n.material.opacity=n.material.userData.baseOpacity*fade;}});}
      slot.core.visible=slot.glow.visible=slash;slot.pulse.visible=slot.frame.visible=slot.ripple.visible=!slash&&!isCharge;
      if(slash){if(w.orientation==='horizontal'){slot.group.quaternion.multiply(horizontal);slot.group.scale.set(w.rx,w.rz,w.ry);}else slot.group.scale.set(w.rx,w.ry,w.rz);const comboStage=swordComboEffects.waveStyle(w);slot.core.material.color.set(enemy?'#ff9275':comboStage===3?'#fff5cc':'#dcfcff');slot.glow.material.color.set(comboStage===3?'#bff5ff':tone);slot.core.material.opacity=(quiet?.36:comboStage===3?.30:comboStage?.22:.78)*fade;slot.glow.material.opacity=(quiet?.08:comboStage?.08:.28)*fade;}
      else{if(isCharge){
        const heroOwned=Number.isInteger(controlledActorId)&&w.sourceId===controlledActorId,rigIndex=npcSpearSlots?.get(w.sourceId),rigPole=Number.isInteger(rigIndex)?npcRigSpears[rigIndex]:null,pole=heroOwned?heroCharge:rigPole||chargeSpears[i],anchor=chargeGrips?.get(w.sourceId);
        tip.set(w.x+w.dx*w.rz,w.y,w.z+w.dz*w.rz);
        const contactTip={x:tip.x,y:tip.y,z:tip.z},shownTip=heroOwned||rigPole?chargeDisplayTips?.get(w.sourceId):null;if(shownTip)tip.copy(shownTip);
        // Static/fallback rigs keep the same authored right-palm socket, rotated
        // with the actor, rather than substituting a centered detached spear.
        if(anchor)grip.copy(anchor);else grip.set(w.x-w.dx*.55-w.dz*.8234+w.dx*.0833,w.y-1.9+1.4094,w.z-w.dz*.55+w.dx*.8234+w.dz*.0833);
        (heroOwned||rigPole?heroAccents:accents).placeHeldSpear(pole,grip,tip,w.dx,w.dz);pole.visible=fade>0;pole.userData.actorId=w.sourceId;pole.userData.contactTip=contactTip;
        if(pole.visible)(heroOwned?heroTipVisibility:rigPole?npcRigTipVisibility:tipVisibility).add(pole,tip,{id:w.sourceId,x:w.x-w.dx*.55,y:w.y-1.9,z:w.z-w.dz*.55,dx:w.dx,dz:w.dz},cameraPosition,occluders,enemy,fade);
        for(const n of pole.children){n.material.color.setHex(n.material.userData.role==='core'?(enemy?0xffcfbb:0xc3f7ff):(enemy?0xff684f:0x70edff));n.material.opacity=n.material.userData.baseOpacity*fade*(quiet?.65:1);}
      }if(isCharge&&!quiet){
        // The displayed point stays inside the existing charge ellipsoid;
        // trailing speed cues never increase its forward attack reach.
        const launch=THREE.MathUtils.smoothstep(w.age,0,.055),flow=.09*Math.sin(w.age*38);spearTrails.addFromGrip(tip,grip,2.3,fade,enemy,1.90+.35*launch+flow);
      }slot.group.scale.set(1,1,1);slot.pulse.scale.set(w.rx,w.ry,w.rz);slot.frame.scale.set(w.rx,w.ry,1);slot.pulse.material.color.set(tone);slot.frame.material.color.set(enemy?'#ffad8a':isCharge?'#e1fbff':'#defcff');slot.pulse.material.opacity=(quiet?.09:.19)*fade;slot.frame.material.opacity=(quiet?.42:.84)*fade;const pulseScale=.8+.18*Math.sin(w.age*28);slot.ripple.scale.set(w.rx*pulseScale,w.ry*pulseScale,1);slot.ripple.position.z=w.rz*.25;slot.ripple.material.color.set(tone);slot.ripple.material.opacity=(quiet?.16:.48)*fade;}
    }
    for(const preview of npcChargePreviews){const pole=npcRigSpears[preview.slot],a=preview.actor;if(!pole||!preview.grip||!a?.alive)continue;tip.set(a.x+a.aimDx*1.7,(a.y||0)+1.9,a.z+a.aimDz*1.7);if(preview.displayTip)tip.copy(preview.displayTip);heroAccents.placeHeldSpear(pole,preview.grip,tip,a.aimDx,a.aimDz);pole.visible=true;pole.userData.actorId=a.id;for(const m of pole.userData.fadeMaterials){m.color.setHex(m.userData.role==='core'?(a.team==='enemy'?0xffcfbb:0xc3f7ff):(a.team==='enemy'?0xff684f:0x70edff));m.opacity=m.userData.baseOpacity*.62*(quiet?.65:1);m.depthWrite=false;}npcRigTipVisibility.add(pole,tip,{id:a.id,x:a.x,y:a.y||0,z:a.z,dx:a.aimDx,dz:a.aimDz},cameraPosition,occluders,a.team==='enemy',.62);}
    if(chargePreview?.spear?.visible){const a=chargePreview.actor;tip.set(a.x+a.dx*1.7,(a.y||0)+1.9,a.z+a.dz*1.7);if(chargePreview.displayTip)tip.copy(chargePreview.displayTip);heroTipVisibility.add(chargePreview.spear,tip,a,cameraPosition,occluders,a.team==='enemy',.62*(chargePreview.opacity??1));}
    spearTrails.finish();tipVisibility.finish();heroTipVisibility.finish();npcRigTipVisibility.finish();
    afterTimer+=dt;if(charge&&!quiet&&afterTimer>.045){afterTimer=0;const a=afterimages[nextAfter++%afterimages.length];a.age=0;a.mesh.position.set(charge.x-charge.dx*.65,charge.y,charge.z-charge.dz*.65);a.mesh.quaternion.setFromUnitVectors(forward,direction.set(charge.dx,0,charge.dz));a.mesh.scale.set(charge.rx,charge.ry,1);}
    for(const a of afterimages){a.age+=dt;a.mesh.visible=false;a.mesh.material.opacity=.33*Math.max(0,1-a.age/.28);}
    for(let i=0;i<60;i++){const e=enemies[i],active=e?.alive&&e.attack==='windup';dummy.position.set(e?.x||0,.035,e?.z||0);dummy.rotation.set(-Math.PI/2,0,0);dummy.scale.setScalar(active?1+Math.max(0,e.attackTimer)/(e.windupDuration||.75)*.4:0);dummy.updateMatrix();telegraphs.setMatrixAt(i,dummy.matrix);telegraphs.setColorAt(i,color.set(e?.team==='ally'?'#45dfff':'#ff4d3d'));dummy.position.set((e?.x||0)+(e?.aimDx||0)*1.8,.038,(e?.z||0)+(e?.aimDz||0)*1.8);dummy.rotation.set(-Math.PI/2,0,Math.atan2(e?.aimDx||0,e?.aimDz??1));dummy.scale.setScalar(active?1:0);dummy.updateMatrix();arrows.setMatrixAt(i,dummy.matrix);arrows.setColorAt(i,color.set(e?.team==='ally'?'#45dfff':'#ff6546'));}
    for(let i=0;i<60;i++){const e=enemies[i],active=e?.alive&&e.attack==='windup',knight=e?.piece==='knight',dx=e?.aimDx||0,dz=e?.aimDz??1,slash=e?.actionKind==='sweep',thrust=e?.actionKind==='thrust',reach=slash?5.94:e?.actionKind==='charge'?10.34:thrust?thrustSpec.reach-thrustSpec.start+2*(thrustSpec.radius+.6):8.23,center=slash?2.92:e?.actionKind==='charge'?3.97:thrust?(thrustSpec.reach+thrustSpec.start)/2:3.46;dummy.position.set((e?.x||0)+dx*center-(thrust?dz*thrustSpec.right:0),.03,(e?.z||0)+dz*center+(thrust?dx*thrustSpec.right:0));dummy.rotation.set(-Math.PI/2,0,Math.atan2(dx,dz));dummy.scale.set(active&&!knight?(slash?5/3.7:e?.actionKind==='charge'?4/3.7:thrust?2*(thrustSpec.radius+.6)/3.7:1):0,active&&!knight?reach/8.23:0,1);dummy.updateMatrix();lanes.setMatrixAt(i,dummy.matrix);lanes.setColorAt(i,color.set(e?.team==='ally'?'#45dfff':'#ff4d3d'));const lx=(e?.x||0)+Math.sign(dx)*3,lz=(e?.z||0)+(e?.team==='ally'?-6:6),landingInside=!arena||dx!==0&&e.x>=arena.minX&&e.x<=arena.maxX&&e.z>=arena.minZ&&e.z<=arena.maxZ&&lx>=arena.minX&&lx<=arena.maxX&&lz>=arena.minZ&&lz<=arena.maxZ;dummy.position.set(arena?lx:Math.max(-19,Math.min(19,lx)),.04,arena?lz:Math.max(-24,Math.min(34,lz)));dummy.rotation.set(-Math.PI/2,0,0);dummy.scale.setScalar(active&&knight&&landingInside?1:0);dummy.updateMatrix();landWarnings.setMatrixAt(i,dummy.matrix);landWarnings.setColorAt(i,color.set(e?.team==='ally'?'#45dfff':'#ff4d3d'));}lanes.instanceMatrix.needsUpdate=landWarnings.instanceMatrix.needsUpdate=true;if(lanes.instanceColor)lanes.instanceColor.needsUpdate=true;if(landWarnings.instanceColor)landWarnings.instanceColor.needsUpdate=true;
    telegraphs.instanceMatrix.needsUpdate=arrows.instanceMatrix.needsUpdate=true;if(telegraphs.instanceColor)telegraphs.instanceColor.needsUpdate=true;if(arrows.instanceColor)arrows.instanceColor.needsUpdate=true;
    for(const item of impacts){
      if(item.fresh)item.fresh=false;else item.age+=dt;
      item.depthTestedBurst=item.thrust&&!quiet;
      const contact=item.lethal===false||item.finisher||item.charge,show=item.age<item.life&&(!quiet||contact)&&!contactCenterOccluded(item,cameraPosition,occluders);item.ground.visible=show;item.flash.visible=show&&!item.guard&&(item.finisher?!quiet&&item.age<.15:!item.thrust&&!item.charge||!quiet&&item.age<.105);
      if(!show)continue;
      if(contact){
        if(item.thrust)item.ground.geometry=quiet?(item.finisher?finisherGeo:contactGeo):spearImpactGeo;
        const progress=Math.min(1,item.age/item.life),small=item.compact?.36:1,fade=Math.max(0,1-Math.max(0,item.age-.045)/(item.life-.045));
        // The existing contact lifetime is unchanged. A 25 ms visual attack
        // then a fast inward falloff gives one crisp beat, with no lasting ring.
        const peak=item.finisher?1.30:1.18,burstScale=item.age<.025?.72+(peak-.72)*THREE.MathUtils.smoothstep(item.age,0,.025):peak-(peak-.50)*THREE.MathUtils.smoothstep(item.age,.025,.16);
        // Reduced effects retain one small, stationary symbol with a simple fade.
        if(item.finisher){
          // A crisp local confirmation: close inward, never grow a damage ring.
          // Quiet mode keeps a stationary, smaller star and hides all satellites.
          item.ground.scale.setScalar(quiet?.50:item.thrust?burstScale:.84-.22*progress);item.ground.material.opacity=(quiet?.92:1)*fade;
          item.flash.scale.setScalar(.78-.16*progress);item.flash.material.opacity=Math.max(0,1-item.age/.15);
        }else if(item.thrust||item.charge){
          // Confirmed thrust uses a quick open burst; charge keeps its reviewed
          // shrinking glint. Neither adds a ground ring or changes hit geometry.
          item.ground.scale.setScalar(quiet?.48:item.thrust?burstScale:1.42-.40*progress);item.ground.material.opacity=(quiet?.92:1)*fade;
          item.flash.scale.set((item.charge?1.82:1.56)-.40*progress,.23,1);item.flash.material.opacity=Math.max(0,1-item.age/.105);
        }else{
          item.ground.scale.setScalar(small*(quiet?.48:item.guard?.70:.70-.18*progress));item.ground.material.opacity=(quiet?.92:1)*fade;
          item.flash.scale.setScalar(small*(quiet?.59:.60+.25*progress));item.flash.material.opacity=(quiet?.75:.92)*fade;
        }
        if(item.depthTestedBurst){
          const fit=fitThrustBurst(item,occluders);item.ground.scale.multiplyScalar(fit);
          if(fit<=0)item.ground.visible=item.flash.visible=false;
        }
        if(cameraQuaternion){item.ground.quaternion.copy(cameraQuaternion);item.flash.quaternion.copy(cameraQuaternion);}
        else{item.ground.quaternion.identity();item.flash.quaternion.identity();}
        if(item.finisher){item.ground.rotateZ(-Math.PI/6);item.flash.rotateZ(-Math.PI/6);}else if(item.thrust||item.charge)item.flash.rotateZ(Math.PI/5);
        if(item.charge&&headBounds){
          // Preserve a complete readable mark: shrink uniformly before hiding.
          // Once reduced, this impact never grows back as bodies move away.
          const originalScale=item.ground.scale.x;let fit=item.headFit??1;
          if(fit<=0||!contactHeadsPrepared||!headBounds.ready){item.ground.visible=item.flash.visible=false;continue;}
          item.ground.scale.multiplyScalar(fit);item.flash.scale.multiplyScalar(fit);
          while(contactHeadOccluded(item,cameraPosition,cameraQuaternion)){
            const minimum=Math.min(fit,.48/originalScale),next=Math.max(minimum,fit*.8);
            if(next>=fit-1e-6){item.headFit=0;item.ground.visible=item.flash.visible=false;break;}
            item.ground.scale.multiplyScalar(next/fit);item.flash.scale.multiplyScalar(next/fit);fit=next;item.headFit=fit;
          }
        }
      }else{
        item.ground.rotation.set(-Math.PI/2,0,0);item.ground.scale.setScalar(.3+item.age*8);item.ground.material.opacity=.7*(1-item.age/.38);item.flash.scale.setScalar(.3+item.age*4);item.flash.material.opacity=.8*Math.max(0,1-item.age/.22);if(cameraQuaternion)item.flash.quaternion.copy(cameraQuaternion);
      }
    }
    particles(dt,chipData,chips,quiet,false);particles(dt,sparkData,sparks,quiet,true);contactHeadsPrepared=false;
  }
  return {hit,update,reset,beginContactHeads,addContactHead,headBoundsStats:()=>headBounds?.stats(),stats:()=>({waveCapacity:MAX,chipCapacity:CHIP_COUNT,sparkCapacity:SPARK_COUNT,impactCapacity:impacts.length,activeImpacts:impacts.filter(p=>p.age<p.life).length})};
}

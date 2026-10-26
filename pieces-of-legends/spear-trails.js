/** Presentation only. Axial speed ribbons terminate at the real spear tip.
 * Two fixed instanced submissions, no textures, lights, simulation or hit cues.
 * Quiet mode keeps the physical spear and confirmed contact but removes trails.
 */
export function createSpearTrails(THREE, scene) {
  const CAPACITY=73, identity=new THREE.Quaternion(), forward=new THREE.Vector3(0,0,1);
  const dummy=new THREE.Object3D(),direction=new THREE.Vector3(),tone=new THREE.Color();
  const worldUp=new THREE.Vector3(0,1,0),right=new THREE.Vector3(),up=new THREE.Vector3(),basis=new THREE.Matrix4();
  function ribbon(width,core=false) {
    const vertices=[],colors=[];
    const triangle=(plane,points)=>{for(const [w,z,f] of points){vertices.push(...(plane?[0,w,z]:[w,0,z]));colors.push(f,f,f);}};
    // A bright needle and four short, separated forward-converging speed fins.
    // All geometry stays behind the real point and tapers to zero at the palm.
    // Static pooled geometry: no animation clock, extra mesh or per-frame churn.
    for(let plane=0;plane<2;plane++){
      for(const [a,b,wa,wb,fa,fb] of [[-1,-.68,0,width*.13,0,.22],[-.68,-.12,width*.13,width*.22,.22,.85],[-.12,0,width*.22,0,.85,1]]){
        triangle(plane,[[-wa,a,fa],[wa,a,fa],[-wb,b,fb]]);
        triangle(plane,[[-wb,b,fb],[wa,a,fa],[wb,b,fb]]);
      }
      if(!core)for(const side of [-1,1]){
        // Separated slender streaks rather than a filled fan or shield. Their
        // leading ends converge just behind the real tip, without a halo.
        for(const [a,b,wa,wb,thickness] of [[-.92,-.17,1.45,.35,.12],[-.65,-.035,2.1,.24,.12]]){
          const start=side*width*wa,end=side*width*wb,t=width*thickness;
          triangle(plane,[[start,a,0],[start+side*t,a,.18],[end,b,.90]]);
          triangle(plane,[[start+side*t,a,.18],[end+side*t*.18,b,.90],[end,b,.90]]);
        }
      }
      // Open tip glints end behind the physical point. Their empty center keeps
      // the blade readable; depth testing keeps bodies in front of the light.
      // They share the two original batches, not an expanding shockwave.
      if(!core)for(const side of [-1,1]){
        triangle(plane,[[side*width*.26,-.045,1],[side*width*1.65,-.16,.32],[side*width*1.15,-.18,.08]]);
      }
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));return geometry;
  }
  function batch(name,width,opacity,core=false) {
    const material=new THREE.MeshBasicMaterial({color:0xffffff,vertexColors:true,transparent:true,opacity,side:THREE.DoubleSide,depthTest:true,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false,forceSinglePass:true});
    const mesh=new THREE.InstancedMesh(ribbon(width,core),material,CAPACITY);mesh.name=name;mesh.frustumCulled=false;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.count=0;mesh.visible=false;scene.add(mesh);return mesh;
  }
  const glow=batch('spear-speed-ribbons',.14,.78),core=batch('spear-speed-cores',.038,.98,true);
  let count=0;
  function reset(){count=0;glow.count=core.count=0;glow.visible=core.visible=false;}
  function add(x,y,z,dx,dz,length,opacity,enemy=false,width=1,dy=0) {
    if(count>=CAPACITY||!(length>.015)||!(opacity>0)||![x,y,z,dx,dy,dz,length,opacity,width].every(Number.isFinite))return;
    direction.set(dx,dy,dz);if(direction.lengthSq()<1e-10)return;direction.normalize();
    right.crossVectors(worldUp,direction);if(right.lengthSq()<1e-10)right.set(1,0,0);right.normalize();up.crossVectors(direction,right).normalize();basis.makeBasis(right,up,direction);
    dummy.position.set(x,y,z);dummy.quaternion.setFromRotationMatrix(basis);dummy.scale.set(width,width,length);dummy.updateMatrix();
    glow.setMatrixAt(count,dummy.matrix);core.setMatrixAt(count,dummy.matrix);
    glow.setColorAt(count,tone.setHex(enemy?0xff5538:0x24cfff).multiplyScalar(opacity));
    core.setColorAt(count,tone.setHex(enemy?0xffd3b5:0xd8fbff).multiplyScalar(opacity));count++;
  }
  // The speed light belongs to the visible pole, not the centered attack lane.
  // End at its displayed point and stop at the right palm; never light the
  // rear haft or draw a second axis through the owner. Gameplay is untouched.
  function addFromGrip(tip,grip,length,opacity,enemy=false,width=1){
    const dx=tip.x-grip.x,dy=tip.y-grip.y,dz=tip.z-grip.z;
    add(tip.x,tip.y,tip.z,dx,dz,Math.min(length,Math.hypot(dx,dy,dz)),opacity,enemy,width,dy);
  }
  function finish(){for(const mesh of [glow,core]){mesh.count=count;mesh.visible=count>0;mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;}}
  return {reset,add,addFromGrip,finish,capacity:CAPACITY};
}

/** Restrained forward-pole outline where the owner's body can occlude the exact
 * point. It is never a hit indicator, and conservative other-body tests suppress
 * it behind another actor. No physical geometry or forward bounds are enlarged.
 */
export function createSpearTipVisibility(THREE,scene,geometry,shaft=null,{capacity=73,name='self-occluded-spear-outlines'}={}) {
  // The forward shaft is part of the same physical pole. Carry its actual
  // surface into the visibility silhouette so an upward tip does not read as
  // a disconnected mark on the wearer. Crop the dark rear haft, not the point.
  if(shaft){
    shaft.updateMatrix();
    const vertices=Array.from(geometry.attributes.position.array),tones=vertices.map(()=>1),source=shaft.geometry;
    const position=source.attributes.position,index=source.index?.array||Array.from({length:position.count},(_,i)=>i),cut=.22;
    const point=i=>new THREE.Vector3().fromBufferAttribute(position,i).applyMatrix4(shaft.matrix);
    for(let i=0;i<index.length;i+=3){
      let polygon=[point(index[i]),point(index[i+1]),point(index[i+2])],clipped=[];
      for(let j=0;j<polygon.length;j++){const a=polygon[j],b=polygon[(j+1)%polygon.length],inside=a.z>=cut,next=b.z>=cut;if(inside)clipped.push(a);if(inside!==next)clipped.push(a.clone().lerp(b,(cut-a.z)/(b.z-a.z)));}
      for(let j=1;j+1<clipped.length;j++)for(const p of [clipped[0],clipped[j],clipped[j+1]]){vertices.push(p.x,p.y,p.z);const brightness=.3+.7*THREE.MathUtils.smoothstep(p.z,cut,.72);tones.push(brightness,brightness,brightness);}
    }
    geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(tones,3));
  }
  const CAPACITY=capacity,ray=new THREE.Ray(),direction=new THREE.Vector3(),center=new THREE.Vector3(),hit=new THREE.Vector3();
  const sphere=new THREE.Sphere(),color=new THREE.Color(),shaftRear=new THREE.Vector3(),nearest=new THREE.Vector3(),viewMin=new THREE.Vector3(),viewMax=new THREE.Vector3(),viewWedge=new THREE.Triangle();let count=0;
  const material=new THREE.MeshBasicMaterial({color:0xffffff,vertexColors:!!shaft,wireframe:true,transparent:true,opacity:.66,depthTest:true,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false});
  const mesh=new THREE.InstancedMesh(geometry,material,CAPACITY);mesh.name=name;mesh.renderOrder=7;mesh.frustumCulled=false;mesh.count=0;mesh.visible=false;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);scene.add(mesh);
  function reset(quiet=false){count=0;mesh.count=0;mesh.visible=false;material.opacity=quiet?.42:.66;}
  function add(pole,tip,owner,camera,enemies,enemy=false,opacity=1){
    if(!camera||!owner||count>=CAPACITY||opacity<=.05)return;
    direction.copy(camera).sub(tip);const distance=direction.length();if(distance<1e-6)return;direction.divideScalar(distance);ray.set(tip,direction);
    // The upper-body envelope includes the original rig's forward charge lean.
    center.set(owner.x+(owner.dx||0)*.55,(owner.y||0)+2.55,owner.z+(owner.dz||0)*.55);sphere.set(center,1.12);
    if(!ray.intersectSphere(sphere,hit)||hit.distanceTo(tip)>distance)return;
    pole.updateMatrixWorld(true);
    if(shaft){shaftRear.set(0,0,.22).applyMatrix4(pole.matrixWorld);viewWedge.set(camera,tip,shaftRear);viewMin.copy(camera).min(tip).min(shaftRear).addScalar(-2.53);viewMax.copy(camera).max(tip).max(shaftRear).addScalar(2.53);}
    // Never reveal this outline through another living combatant. With the
    // shaft enabled, test the whole viewing wedge, not only the ray to the tip.
    // The extra .28 conservatively encloses the head/shaft cross-section;
    // it broadens suppression, never the shown geometry or the hit volume.
    for(const actor of enemies||[]){
      if(!actor.alive||actor.id===owner.id)continue;
      center.set(actor.x,(actor.y||0)+1.9,actor.z);
      if(shaft){if(center.x<viewMin.x||center.x>viewMax.x||center.y<viewMin.y||center.y>viewMax.y||center.z<viewMin.z||center.z>viewMax.z)continue;viewWedge.closestPointToPoint(center,nearest);if(nearest.distanceToSquared(center)<2.53*2.53)return;}
      else{sphere.set(center,2.25);if(ray.intersectSphere(sphere,hit)&&hit.distanceTo(tip)<distance)return;}
    }
    mesh.setMatrixAt(count,pole.matrixWorld);mesh.setColorAt(count,color.setHex(enemy?0xffa187:0xb7f5ff).multiplyScalar(Math.min(1,opacity)));count++;
  }
  function finish(){mesh.count=count;mesh.visible=count>0;mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;}
  return {reset,add,finish};
}

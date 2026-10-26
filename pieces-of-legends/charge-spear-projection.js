import * as THREE from './vendor/three.module.min.js';
// Charge is a body-led ellipsoid attack, not the point collider used by thrust.
// Keep the visible tip inside that unchanged volume while removing the right-
// hand depth offset from the screen incline. Neither the actor nor hitbox moves.
const viewProjection=new THREE.Matrix4(),normal=new THREE.Vector3(),localNormal=new THREE.Vector3(),center=new THREE.Vector3(),right=new THREE.Vector3(),reference=new THREE.Vector3(),a=new THREE.Vector3(),b=new THREE.Vector3(),g=new THREE.Vector3(),discCenter=new THREE.Vector3(),discDirection=new THREE.Vector3();
export function projectChargeSpearTip(out,{origin,forward,grip,referenceGrip,sourceTip,camera}){
 out.copy(sourceTip);if(!camera?.isCamera)return out;
 camera.updateWorldMatrix(true,false);viewProjection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
 right.set(-forward.z,0,forward.x);
 const ce=camera.matrixWorld.elements,sideways=Math.abs(forward.x*ce[0]+forward.z*ce[2]),sideWeight=THREE.MathUtils.smoothstep(sideways,.25,.85);
 if(sideWeight===0)return out;
 // Compare to the same waist height and fore/aft grip position on the actor's
 // center plane. Fade this correction out for front/back-facing views, where
 // no left/right inclination comparison is needed. Opposite sideways headings then share one projected incline.
 reference.copy(referenceGrip).addScaledVector(right,-a.copy(referenceGrip).sub(origin).dot(right)*sideWeight);
 a.copy(reference).project(camera);b.copy(sourceTip).project(camera);g.copy(grip).project(camera);
 const dx=b.x-a.x,dy=b.y-a.y;if(dx*dx+dy*dy<1e-14)return out;
 // Back-project the desired screen line through the actual, unmirrored palm.
 const nx=-dy,ny=dx,nw=dy*g.x-dx*g.y,e=viewProjection.elements;
 normal.set(nx*e[0]+ny*e[1]+nw*e[3],nx*e[4]+ny*e[5]+nw*e[7],nx*e[8]+ny*e[9]+nw*e[11]);
 const constant=nx*e[12]+ny*e[13]+nw*e[15];
 center.copy(origin).addScaledVector(forward,.55);center.y=origin.y+1.9;
 // The unit-sphere section is the exact section of the engine charge volume:
 // lateral 1.4, vertical 1.9, forward 1.15. Select its closest point to the
 // original front in this normalized space. Forward reach can never exceed 1.7.
 localNormal.set(normal.dot(right)*1.4,normal.y*1.9,normal.dot(forward)*1.15);
 const lengthSq=localNormal.lengthSq(),offset=normal.dot(center)+constant;
 if(lengthSq<1e-20||offset*offset>lengthSq*(1+1e-9))return out;
 discCenter.copy(localNormal).multiplyScalar(-offset/lengthSq);
 discDirection.set(0,0,1).addScaledVector(localNormal,-localNormal.z/lengthSq);
 const radius=Math.sqrt(Math.max(0,1-discCenter.lengthSq()));
 if(discDirection.lengthSq()<1e-20){discDirection.set(1,0,0).addScaledVector(localNormal,-localNormal.x/lengthSq);}
 discDirection.normalize().multiplyScalar(radius).add(discCenter);
 out.copy(center).addScaledVector(right,discDirection.x*1.4).addScaledVector(forward,discDirection.z*1.15);out.y+=discDirection.y*1.9;
 return out;
}

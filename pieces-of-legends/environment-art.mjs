import {applyImperialTexture} from './imperial-materials.mjs';
// Visual-only, finite shallow ford. All geometry reads the immutable engine layout.
// The bank/deck joinery never creates colliders or changes wet/dry travel limits.
export function createEnvironmentArt(THREE,{layout:L,groundMaterial,surface,boardBounds,onReady=()=>{}}){
 if(L.key==='mountain')return createMountainArt(THREE,{arena:L.arena,groundMaterial,surface,boardBounds});
 const root=new THREE.Group();root.name='river-imperial-map-art';
 const material=(color,extra={})=>new THREE.MeshStandardMaterial({color,roughness:.9,...extra});
 const terrainGround=groundMaterial.clone(),baseCompile=groundMaterial.onBeforeCompile;
 terrainGround.userData.boardSurface='natural-grass-earth-tiles-v1';terrainGround.userData.terrainSurface='sandy-pebble-ford-banks-v1';
 terrainGround.onBeforeCompile=shader=>{
  baseCompile?.(shader);shader.uniforms.riverEdges={value:new THREE.Vector2(L.river.minZ,L.river.maxZ)};
  shader.vertexShader='varying vec2 soilPosition;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nsoilPosition=position.xz;');
  shader.fragmentShader='varying vec2 soilPosition; uniform vec2 riverEdges;\n'+shader.fragmentShader.replace('// board-surface-finish',`
   float bankDistance=min(abs(soilPosition.y-riverEdges.x),abs(soilPosition.y-riverEdges.y));
   float soilPatch=boardNoise(soilPosition*.83+vec2(17.0,9.0));
   float sandReach=1.15+soilPatch*.90;
   float shore=1.0-smoothstep(.10,sandReach,bankDistance);
   float damp=1.0-smoothstep(.01,.32,bankDistance);
   vec3 riverSand=mix(vec3(.19,.156,.090),vec3(.255,.225,.144),soilPatch);
   riverSand*=1.0-damp*.26;
   diffuseColor.rgb=mix(diffuseColor.rgb,riverSand,shore*.90);
   // Inset pebble clusters stop at the exact wet boundary; they never create stepping stones.
   vec2 pebbleCell=floor(soilPosition*2.3),pebblePoint=fract(soilPosition*2.3)-.5;
   float pebbleRandom=boardHash(pebbleCell+vec2(7.7,41.1));
   float pebble=(1.0-smoothstep(.14,.23,length(pebblePoint*vec2(1.0,1.3))))*step(.55,pebbleRandom)*shore;
   diffuseColor.rgb=mix(diffuseColor.rgb,mix(vec3(.09,.10,.075),vec3(.31,.29,.215),pebbleRandom),pebble*.70);
   // board-surface-finish
  `);
 };terrainGround.customProgramCacheKey=()=> 'natural-sand-pebble-ford-v1';terrainGround.needsUpdate=true;
 const earth=material('#5d5840'),timber=material('#b3b1a6',{roughness:.92,flatShading:true}),beam=material('#41413d');
 const trim=material('#88826d',{roughness:.92});
 const timberEntry=applyImperialTexture(THREE,timber,'timber',onReady);
 timber.userData.terrainSurface='weathered-oak-v3';
 timber.onBeforeCompile=shader=>{
  shader.vertexShader='varying vec2 timberUv;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\ntimberUv=uv;');
  shader.fragmentShader='varying vec2 timberUv;\n'+shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
   float oakLuma=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));
   diffuseColor.rgb=mix(vec3(oakLuma)*vec3(1.045,1.0,.93),diffuseColor.rgb,.18);
   float oakJoint=smoothstep(.018,.12,min(timberUv.y,1.0-timberUv.y));
   diffuseColor.rgb*=.78+oakJoint*.22;
  `);
 };timber.customProgramCacheKey=()=> 'imperial-weathered-oak-v3';
 const water=material('#7aa5ae',{roughness:.68,metalness:.02});
 const waterEntry=applyImperialTexture(THREE,water,'water',onReady);
 const clock={value:0};water.userData.terrainSurface='shallow-ford-v3';
 water.onBeforeCompile=shader=>{
  shader.uniforms.riverTime=clock;shader.uniforms.riverEdges={value:new THREE.Vector2(L.river.minZ,L.river.maxZ)};shader.uniforms.riverBridges={value:L.bridges.map(([a,b])=>new THREE.Vector2(a,b))};
  shader.vertexShader='varying vec3 riverPosition;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nriverPosition=position;');
  shader.fragmentShader='uniform float riverTime; uniform vec2 riverEdges; uniform vec2 riverBridges[3]; varying vec3 riverPosition;\n'+shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
   vec2 p=riverPosition.xz;
   float bankDistance=min(abs(p.y-riverEdges.x),abs(p.y-riverEdges.y));
   float shallow=1.0-smoothstep(.06,1.3,bankDistance);
   float deckDistance=1000.0;
   for(int i=0;i<3;i++)deckDistance=min(deckDistance,min(abs(p.x-riverBridges[i].x),abs(p.x-riverBridges[i].y)));
   float contact=1.0-smoothstep(.025,.25,min(bankDistance,deckDistance));
   float bend=sin(p.x*.37+p.y*.31)*.55+sin(p.x*.79-p.y*.42)*.19;
   float current=sin(p.y*3.2+bend+p.x*.14-riverTime*.10);
   float broken=sin(p.x*.63+p.y*.17)+sin(p.x*.21-p.y*.49)*.45;
   float glint=smoothstep(.24,.95,current)*smoothstep(-.55,.80,broken);
   float broad=sin(p.x*.27+p.y*.43)+sin(p.x*.16-p.y*.69);
   float waterLuma=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));
   diffuseColor.rgb=mix(vec3(waterLuma)*vec3(.91,1.015,1.065),diffuseColor.rgb,.82);
   diffuseColor.rgb*=.91+broad*.045;
   diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.095,.150,.165),shallow*.32);
   diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.23,.34,.36),glint*.30*(1.0-contact*.8));
   diffuseColor.rgb*=1.0-contact*.42;

  `);
 };water.customProgramCacheKey=()=> 'imperial-shallow-ford-v3';
 const {minZ:z0,maxZ:z1}=L.river,{minX:x0,maxX:x1}=L.arena;
 const wet=[];let x=x0;for(const[a,b]of L.bridges){wet.push([x,a,z0,z1]);x=b;}wet.push([x,x1,z0,z1]);
 const B=boardBounds||{minX:-110,maxX:110,minZ:-24,maxZ:110};
 const soil=surface([[B.minX,B.maxX,B.minZ,z0],[B.minX,B.maxX,z1,B.maxZ],[B.minX,x0,z0,z1],[x1,B.maxX,z0,z1]],-.025,terrainGround);soil.name='ford-grass-sand-playing-surface';root.add(soil);
 // Actor feet retain the original plane: this is traversable shallow water, no trench.
 const waterSurface=surface(wet,-.03,water);waterSurface.name='traversable-shallow-ford';root.add(waterSurface);
 const box=new THREE.BoxGeometry(1,1,1),dummy=new THREE.Object3D();
 function boxes(name,items,mat,geometry=box){const m=new THREE.InstancedMesh(geometry,mat,items.length);m.name=name;items.forEach((a,i)=>{dummy.position.set(...a.slice(0,3));dummy.scale.set(...a.slice(3,6));dummy.rotation.set(0,0,0);dummy.updateMatrix();m.setMatrixAt(i,dummy.matrix);if(a[6])m.setColorAt(i,new THREE.Color(a[6]));});root.add(m);return m;}
 // One shared downward-beveled plank: max y stays at the original deck plane.
 // Outer X/Z extents stay exactly within the same dry rectangle after instancing.
 const pv=[],pu=[],rings=[{x:.5,z:.5,y:-.5},{x:.5,z:.5,y:.32},{x:.478,z:.44,y:.5}];
 const point=(r,i)=>[(i===0||i===3?-1:1)*r.x,r.y,(i<2?-1:1)*r.z];
 const quad=(a,b,c,d)=>{for(const p of[a,b,c,a,c,d]){pv.push(...p);pu.push(p[0]+.5,p[2]+.5);}};
 for(let r=0;r<2;r++)for(let i=0;i<4;i++){const j=(i+1)%4;quad(point(rings[r],i),point(rings[r+1],i),point(rings[r+1],j),point(rings[r],j));}
 quad(point(rings[2],0),point(rings[2],3),point(rings[2],2),point(rings[2],1));
 quad(point(rings[0],0),point(rings[0],1),point(rings[0],2),point(rings[0],3));
 const plankGeometry=new THREE.BufferGeometry();plankGeometry.setAttribute('position',new THREE.Float32BufferAttribute(pv,3));plankGeometry.setAttribute('uv',new THREE.Float32BufferAttribute(pu,2));plankGeometry.computeVertexNormals();
 const banks=[],planks=[],beams=[],joins=[];
 for(const[a,b]of wet)for(const z of[z0,z1]){
  // New lips stay wholly on land. Retained .08-thick bank faces straddle the edge by .04.
  banks.push([(a+b)/2,-.49,z,b-a,.93,.08]);
  // The continuous land/water join is now the sandy material itself, without a raised rail.
 }
 for(const[a,b]of L.bridges){
  const width=b-a,endDepth=.5,n=14,step=(z1-z0-2*endDepth)/n;
  for(let i=0;i<n;i++){const start=z0+endDepth+i*step+.018,end=z0+endDepth+(i+1)*step-.018;planks.push([(a+b)/2,-.09,(start+end)/2,width,.18,end-start,['#eeece3','#cac7bc','#dedbd0','#eeece3','#d7d5ca'][[0,2,1,3,2,4,0,1,3,4,2,0,4,1][i]]]);}
  // Existing dry bridge width/deck extents and height are exact. Everything else is below.
  for(const side of[-1,1])beams.push([(a+b)/2+side*width*.35,-.29,(z0+z1)/2,.22,.32,z1-z0]);
  for(const z of[z0+.14,z1-.14])beams.push([(a+b)/2,-.53,z,width,.88,.28]);
  // Exposed flush thresholds anchor the timber to the land, never into wet space.
  for(const z of[z0-.12,z1+.12])joins.push([(a+b)/2,-.0525,z,width,.065,.24,'#96917e']);
  // Broader end cross pieces are inside the original dry deck rectangle, at y=0.
  for(const z of[z0+endDepth/2,z1-endDepth/2])joins.push([(a+b)/2,-.0375,z,width,.075,endDepth,'#aba89c']);

 }
 boxes('cut-river-bank-faces',banks,earth);boxes('flush-timber-planks',planks,timber,plankGeometry);boxes('under-deck-beams',beams,beam);boxes('flush-bank-and-bridge-joinery',joins,trim);
 let disposed=false;
 return {root,update(time,quiet){clock.value=quiet?0:time;},waterMaterial:water,resources:{meshes:6,boxInstances:banks.length+planks.length+beams.length+joins.length,plankTriangles:planks.length*20,frameAllocations:0},dispose(){if(disposed)return;disposed=true;root.removeFromParent();timberEntry.targets.delete(timber);waterEntry.targets.delete(water);const geos=new Set(),mats=new Set();root.traverse(o=>{if(o.isMesh){geos.add(o.geometry);mats.add(o.material);}});for(const g of geos)g.dispose();for(const m of mats)m.dispose();}};
}

export function createBoundaryArt(THREE,onReady=()=>{}){
  const root=new THREE.Group();root.name='grouped-exterior-outcrops';
  // Shared seven-sided truncated crag rather than inflated sphere silhouettes.
  const vertices=[],indices=[],n=7;
  for(let layer=0;layer<3;layer++)for(let i=0;i<n;i++){
    const a=i/n*Math.PI*2,r=(layer===0?1:layer===1?.93:.58)*(1+.13*Math.sin(i*7.1));
    vertices.push(Math.cos(a)*r,layer===0?-.12:layer===1?.62:1+.12*Math.sin(i*3.8),Math.sin(a)*r);
  }
  for(let l=0;l<2;l++)for(let i=0;i<n;i++){let j=(i+1)%n,a=l*n+i,b=l*n+j;indices.push(a,b,b+n,a,b+n,a+n);}
  for(let i=1;i<n-1;i++)indices.push(14,14+i,15+i);
  let geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geo.setIndex(indices.flatMap((_,i)=>i%3===0?[indices[i],indices[i+2],indices[i+1]]:[]));geo=geo.toNonIndexed();geo.computeVertexNormals();
  const colors=[],position=geo.attributes.position;
  for(let i=0;i<position.count;i+=3){const h=(position.getY(i)+position.getY(i+1)+position.getY(i+2))/3;const f=(.84+.12*Math.sin(i*1.73))*(h<.2?.77:1);for(let k=0;k<3;k++)colors.push(f,f*.99,f*.92);}
  geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  const rockUv=[];for(let i=0;i<position.count;i++)rockUv.push(position.getX(i)*.5+.5,position.getY(i)*.5+.5);
  geo.setAttribute('uv',new THREE.Float32BufferAttribute(rockUv,2));
  const mat=new THREE.MeshStandardMaterial({color:'#ffffff',roughness:1,flatShading:true,vertexColors:true});
  applyImperialTexture(THREE,mat,'stone',onReady);
  const items=[];
  for(const side of [-1,1])for(const z of [-24,-8,9,28]){
    const x=side*(25+Math.sin(z)*1.2);
    items.push([x,z,2.2,2.8,1.6],[x+side*2.5,z+1.9,2.8,1.8,2.2],[x-side*1.2,z+2.1,1.3,1.1,1.2]);
  }
  const rocks=new THREE.InstancedMesh(geo,mat,items.length),d=new THREE.Object3D();rocks.name='24-clustered-crags';
  items.forEach(([x,z,sx,sy,sz],i)=>{d.position.set(x,-.05,z);d.scale.set(sx,sy,sz);d.rotation.set(0,i*2.39,0);d.updateMatrix();rocks.setMatrixAt(i,d.matrix);rocks.setColorAt(i,new THREE.Color(['#8a8575','#a49a80','#797969'][i%3]));});root.add(rocks);return root;
}

// Mountain is a topographic board treatment, not a raised collider or tilted
// actor plane. Height bands and downhill chevrons communicate absolute +z.
// Actor feet, camera, attack volumes and existing board joinery stay unchanged.
function createMountainArt(THREE,{arena:A,groundMaterial,surface,boardBounds}){
 const root=new THREE.Group();root.name='mountain-topographic-map-art';
 root.userData={terrain:'mountain',highZ:A.minZ,lowZ:A.maxZ,physicalSlope:false};
 const B=boardBounds||A,material=groundMaterial.clone(),baseCompile=groundMaterial.onBeforeCompile;
 material.userData.terrainSurface='mountain-rock-grass-tiles-v2';
 material.onBeforeCompile=shader=>{
  baseCompile?.(shader);shader.uniforms.mountainRange={value:new THREE.Vector2(A.minZ,A.maxZ)};
  shader.vertexShader='varying vec2 mountainPosition;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nmountainPosition=position.xz;');
  shader.fragmentShader='varying vec2 mountainPosition; uniform vec2 mountainRange;\n'+shader.fragmentShader.replace('// board-surface-finish',`
   float downhill=clamp((mountainPosition.y-mountainRange.x)/(mountainRange.y-mountainRange.x),0.0,1.0);
   float mountainPatch=boardNoise(mountainPosition*.29+vec2(14.7,33.1));
   float scree=boardNoise(mountainPosition*1.14+vec2(8.7,2.1));
   float highland=1.0-smoothstep(.10,.88,downhill);
   float rockiness=smoothstep(.43,.68,highland*.66+mountainPatch*.40+scree*.12);
   // Uneven interlocking bedrock plates, with dark local fissures instead of a pale wash.
   vec2 rockP=mountainPosition*.57,rockCell=floor(rockP),rockLocal=fract(rockP);
   float nearestRock=100.0,nextRock=100.0,rockSeed=0.0;
   for(int rx=-1;rx<=1;rx++)for(int rz=-1;rz<=1;rz++){
    vec2 neighbor=vec2(float(rx),float(rz));
    float seed=boardHash(rockCell+neighbor+vec2(8.9,21.7));
    vec2 offset=vec2(seed,boardHash(rockCell+neighbor+vec2(31.2,2.5)));
    float distanceToRock=length(neighbor+.18+offset*.64-rockLocal);
    if(distanceToRock<nearestRock){nextRock=nearestRock;nearestRock=distanceToRock;rockSeed=seed;}
    else nextRock=min(nextRock,distanceToRock);
   }
   float fissure=1.0-smoothstep(.025,.068,nextRock-nearestRock);
   vec3 mountainRock=mix(vec3(.070,.069,.054),vec3(.167,.151,.110),rockSeed*.63+scree*.37);
   mountainRock*=.86+scree*.23;
   mountainRock=mix(mountainRock,vec3(.039,.044,.028),fissure*.70);
   // Exposed plates break into grass pockets downhill, rather than translucent height bands.
   diffuseColor.rgb=mix(diffuseColor.rgb,mountainRock,rockiness*(1.0-boardBorder*.85));
   float contourPhase=downhill*6.0+sin(mountainPosition.x*.26)*.045+sin(mountainPosition.x*.73)*.018;
   float contourDistance=abs(fract(contourPhase+.5)-.5)*(mountainRange.y-mountainRange.x)/6.0;
   float contour=1.0-smoothstep(.020,.072,contourDistance);
   diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.23,.212,.136),contour*.23*(1.0-boardBorder));
   diffuseColor.rgb*=1.0-boardSeam*.07;
   // board-surface-finish
  `);
 };material.customProgramCacheKey=()=> 'mountain-rock-grass-tiles-v2';material.needsUpdate=true;
 const floor=surface([[B.minX,B.maxX,B.minZ,B.maxZ]],-.025,material);floor.name='mountain-topographic-playing-surface';root.add(floor);
 const vertices=[],zSpan=A.maxZ-A.minZ;
 for(const x of [A.minX+1.1,A.maxX-1.1])for(const f of [.23,.5,.77]){
  const z=A.minZ+zSpan*f;
  // An open V, pointing down the board (+z), with a constant-width gold stroke.
  const points=[[x-.50,z-.32],[x,z+.20],[x+.50,z-.32],[x+.50,z-.07],[x,z+.45],[x-.50,z-.07]];
  for(const ids of [[0,1,5],[5,1,4],[1,2,3],[1,3,4]])for(const i of ids)vertices.push(points[i][0],.006,points[i][1]);
 }
 const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geo.computeVertexNormals();
 const arrows=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color:'#d7be83',side:THREE.DoubleSide,transparent:true,opacity:.64,depthWrite:false}));arrows.name='mountain-downhill-chevrons';root.add(arrows);
 let disposed=false;return {root,update(){},resources:{meshes:2,textures:0,frameUpdates:0,frameAllocations:0},dispose(){if(disposed)return;disposed=true;root.removeFromParent();floor.geometry.dispose();material.dispose();geo.dispose();arrows.material.dispose();}};
}

export const DIORAMA_BOARD_MARGIN=2.2;
// Decorative cells only: actor positions, formation spacing and legal bounds never snap.
// A coarse square field is fitted inside authored rectangles; any remainder is a
// symmetric, ungridded apron. The 38x38 army board therefore has nine complete rows.
export function boardGrid(arena){
 const w=arena.maxX-arena.minX,h=arena.maxZ-arena.minZ,target=38/9;
 if(![w,h,arena.minX,arena.minZ].every(Number.isFinite)||w<=0||h<=0)throw new Error('Invalid grid arena');
 const columns=Math.max(1,Math.round(w/target)),rows=Math.max(1,Math.round(h/target));
 const cellSize=Math.min(w/columns,h/rows),width=cellSize*columns,depth=cellSize*rows;
 const apronX=Math.max(0,(w-width)/2),apronZ=Math.max(0,(h-depth)/2),minX=arena.minX+apronX,minZ=arena.minZ+apronZ;
 return Object.freeze({minX,maxX:minX+width,minZ,maxZ:minZ+depth,cellSize,columns,rows,apronX,apronZ});
}
// One persistent finite board. Its bounded geometry/transforms change only at reset.
// Passed arena values are actor-centre bounds; this renderer never creates colliders.
export function createDioramaBoard(THREE,{layout,onReady=()=>{}}){
 const root=new THREE.Group();root.name='finite-strategy-board';const margin=DIORAMA_BOARD_MARGIN;
 let A={...layout.arena},top,w,d,cx,cz,disposed=false;const arenaVector=new THREE.Vector4(),gridVector=new THREE.Vector4(),gridCount=new THREE.Vector2(),groundMeshes=new Set(),groundMaterials=new Set();
 const updateBounds=()=>{top=Object.freeze({minX:A.minX-margin,maxX:A.maxX+margin,minZ:A.minZ-margin,maxZ:A.maxZ+margin});cx=(top.minX+top.maxX)/2;cz=(top.minZ+top.maxZ)/2;w=top.maxX-top.minX;d=top.maxZ-top.minZ;arenaVector.set(A.minX,A.maxX,A.minZ,A.maxZ);const grid=boardGrid(A);gridVector.set(grid.minX,grid.minZ,grid.cellSize,0);gridCount.set(grid.columns,grid.rows);};updateBounds();const baseW=w,baseD=d;
 const make=(color,extra={})=>new THREE.MeshStandardMaterial({color,roughness:.84,metalness:0,...extra});
 // A shallow cutaway of soil and bedrock joins the floor without a manufactured rim.
 // All raised vertices stay outside the original 2.2-unit visual margin.
 const earth=make('#443a2c',{roughness:1});
 const under=new THREE.Mesh(new THREE.BoxGeometry(w+.30,1.70,d+.30),earth);under.name='board-earth-core';root.add(under);
 const profiles=[{pad:0,y:-.025,color:'#68704b'},{pad:.23,y:.08,color:'#657044'},{pad:.63,y:-.05,color:'#626047'},{pad:.78,y:-.46,color:'#65533c'},{pad:.56,y:-1.20,color:'#51442f'},{pad:.71,y:-1.76,color:'#3d3b31'},{pad:.54,y:-2.05,color:'#302f29'}];
 const positions=[],colors=[],uv=[],edgeSegments=20,perimeterCount=edgeSegments*4;
 const perimeter=(i,pad)=>{const edge=Math.floor(i/edgeSegments),t=(i%edgeSegments)/edgeSegments;return edge===0?[cx-w/2-pad+(w+2*pad)*t,cz-d/2-pad]:edge===1?[cx+w/2+pad,cz-d/2-pad+(d+2*pad)*t]:edge===2?[cx+w/2+pad-(w+2*pad)*t,cz+d/2+pad]:[cx-w/2-pad,cz+d/2+pad-(d+2*pad)*t];};
 const edgePoint=(row,i)=>{const p=profiles[row],n=Math.sin(i*1.73)+Math.sin(i*.47)*.43,pad=p.pad*(1+n*.20),[x,z]=perimeter(i,pad);return [x,p.y+(row===0?0:Math.sin(i*2.17+row*.8)*.045),z];};
 function shellValues(){positions.length=colors.length=uv.length=0;function tri(a,b,c,color,tone){const col=new THREE.Color(color).multiplyScalar(tone);for(const p of[a,b,c]){positions.push(...p);colors.push(col.r,col.g,col.b);uv.push((p[0]+p[2])*.16,p[1]*.45);}}for(let row=0;row<profiles.length-1;row++)for(let i=0;i<perimeterCount;i++){const k=(i+1)%perimeterCount,a=edgePoint(row,i),b=edgePoint(row,k),c=edgePoint(row+1,k),e=edgePoint(row+1,i),tone=.91+.09*Math.sin(i*2.31+row*1.7);tri(a,b,c,profiles[row].color,tone);tri(a,c,e,profiles[row].color,tone*.97);}}shellValues();
 const shellGeo=new THREE.BufferGeometry();shellGeo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));shellGeo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));shellGeo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));shellGeo.computeVertexNormals();
 const shell=new THREE.Mesh(shellGeo,make('#ffffff',{vertexColors:true,roughness:1,side:THREE.DoubleSide}));shell.name='natural-earth-and-bedrock-edge';root.add(shell);
 // Low flattened stones are partially buried in the apron, never separate fence posts.
 const pebblePositions=[],pebbleColors=[],nRock=7;
 const rockPoint=(row,i)=>{const a=i/nRock*Math.PI*2,r=(row===0?1:row===1?.87:.46)*(1+.16*Math.sin(i*3.7));return [Math.cos(a)*r,row===0?-.15:row===1?.24:.46+Math.sin(i*2.7)*.08,Math.sin(a)*r];};
 const rockTri=(a,b,c,tone)=>{for(const p of[a,b,c]){pebblePositions.push(...p);pebbleColors.push(tone,tone*.99,tone*.86);}};
 for(let row=0;row<2;row++)for(let i=0;i<nRock;i++){const j=(i+1)%nRock,a=rockPoint(row,i),b=rockPoint(row,j),c=rockPoint(row+1,j),d=rockPoint(row+1,i),tone=.67+.18*Math.sin(i*2.43+row);rockTri(a,d,c,tone);rockTri(a,c,b,tone);}
 for(let i=1;i<nRock-1;i++){rockTri(rockPoint(2,0),rockPoint(2,i+1),rockPoint(2,i),.94);rockTri(rockPoint(0,0),rockPoint(0,i),rockPoint(0,i+1),.6);}
 const rockGeo=new THREE.BufferGeometry();rockGeo.setAttribute('position',new THREE.Float32BufferAttribute(pebblePositions,3));rockGeo.setAttribute('color',new THREE.Float32BufferAttribute(pebbleColors,3));rockGeo.computeVertexNormals();
 const rockMat=make('#8b8974',{vertexColors:true,roughness:1,flatShading:true});
 const caps=new THREE.InstancedMesh(rockGeo,rockMat,12),dummy=new THREE.Object3D();caps.name='buried-corner-stones';root.add(caps);
 const relief=new THREE.InstancedMesh(rockGeo,rockMat,24);relief.name='scattered-apron-stones';root.add(relief);
 const tabletop=new THREE.Mesh(new THREE.PlaneGeometry(240,240),new THREE.MeshBasicMaterial({color:'#202938',toneMapped:false,fog:false}));tabletop.name='board-surround-tabletop';tabletop.rotation.x=-Math.PI/2;root.add(tabletop);
 const n=128,bytes=new Uint8Array(n*n*4);for(let y=0;y<n;y++)for(let x=0;x<n;x++){const dx=Math.max(0,Math.abs((x+.5)/n-.5)-.444),dy=Math.max(0,Math.abs((y+.5)/n-.5)-.454),fade=Math.exp(-(dx*dx+dy*dy)*1900),i=(y*n+x)*4;bytes[i]=bytes[i+1]=bytes[i+2]=255;bytes[i+3]=Math.round(255*fade);}
 const shadowMap=new THREE.DataTexture(bytes,n,n,THREE.RGBAFormat);shadowMap.needsUpdate=true;shadowMap.name='diorama-static-shadow';shadowMap.magFilter=THREE.LinearFilter;shadowMap.minFilter=THREE.LinearFilter;shadowMap.generateMipmaps=false;
 const shadow=new THREE.Mesh(new THREE.PlaneGeometry(w+5.5,d+5.5),new THREE.MeshBasicMaterial({color:'#182018',map:shadowMap,transparent:true,opacity:.32,depthWrite:false}));shadow.name='board-static-contact-shadow';shadow.rotation.x=-Math.PI/2;root.add(shadow);
 function updateSurface(mesh){const p=mesh.geometry.attributes.position,t=mesh.geometry.attributes.uv;if(p.count!==6)throw new Error('Expected one rectangular playing surface');[[top.minX,top.minZ],[top.minX,top.maxZ],[top.maxX,top.maxZ],[top.minX,top.minZ],[top.maxX,top.maxZ],[top.maxX,top.minZ]].forEach(([x,z],i)=>{p.setXYZ(i,x,-.025,z);t?.setXY(i,(x+110)/220,(110-z)/134);});p.needsUpdate=true;if(t)t.needsUpdate=true;mesh.geometry.computeBoundingBox();mesh.geometry.computeBoundingSphere();}
 function updateGeometry(){
  under.position.set(cx,-1.12,cz);under.scale.set((w+.30)/(baseW+.30),1,(d+.30)/(baseD+.30));shellValues();shellGeo.attributes.position.array.set(positions);shellGeo.attributes.position.needsUpdate=true;shellGeo.attributes.color.array.set(colors);shellGeo.attributes.color.needsUpdate=true;shellGeo.attributes.uv.array.set(uv);shellGeo.attributes.uv.needsUpdate=true;shellGeo.computeVertexNormals();shellGeo.computeBoundingBox();shellGeo.computeBoundingSphere();
  let i=0;for(const z of[top.minZ,top.maxZ])for(const x of[top.minX,top.maxX])for(let k=0;k<3;k++){const sx=Math.sign(x-cx),sz=Math.sign(z-cz);dummy.position.set(x-sx*(.25+k*.25),-.055,z-sz*(.33+(k%2)*.32));dummy.rotation.set(0,i*2.37,0);dummy.scale.set(.48-k*.08,.58-k*.08,.37+k*.045);dummy.updateMatrix();caps.setMatrixAt(i++,dummy.matrix);}caps.instanceMatrix.needsUpdate=true;caps.computeBoundingBox();caps.computeBoundingSphere();
  i=0;for(let side=0;side<4;side++)for(let j=0;j<6;j++){const cluster=Math.floor(j/3),local=j%3,t=.17+cluster*.56+side*.024+(local-1)*.027,edge=.39+local*.17+.12*Math.sin(j*3.7+side),x=side===0||side===2?top.minX+w*t:side===1?top.maxX-edge:top.minX+edge,z=side===1||side===3?top.minZ+d*t:side===0?top.minZ+edge:top.maxZ-edge;dummy.position.set(x,-.08,z);dummy.rotation.set(0,i*2.39,0);dummy.scale.set(.23+.15*(1+Math.sin(i*1.6)),.31+.13*(1+Math.sin(i*3.1)),.19+.12*(1+Math.sin(i*2.2)));dummy.updateMatrix();relief.setMatrixAt(i++,dummy.matrix);}relief.instanceMatrix.needsUpdate=true;relief.computeBoundingBox();relief.computeBoundingSphere();
  tabletop.position.set(cx,-2.15,cz);shadow.position.set(cx+.38,-2.13,cz+.45);shadow.scale.set((w+5.5)/(baseW+5.5),(d+5.5)/(baseD+5.5),1);
  for(const mesh of groundMeshes)updateSurface(mesh);for(const mat of groundMaterials){mat.userData.dioramaBoundary=[A.minX,A.maxX,A.minZ,A.maxZ];mat.userData.boardGrid=boardGrid(A);}root.updateMatrixWorld(true);
 }
 function setArena(next){if(disposed)throw new Error('Board was disposed');if(!['minX','maxX','minZ','maxZ'].every(k=>Number.isFinite(next?.[k]))||next.minX>=next.maxX||next.minZ>=next.maxZ)throw new Error('Invalid board arena');if(['minX','maxX','minZ','maxZ'].every(k=>A[k]===next[k]))return false;A={minX:next.minX,maxX:next.maxX,minZ:next.minZ,maxZ:next.maxZ};updateBounds();updateGeometry();return true;}
 function styleGround(material){
  groundMaterials.add(material);material.userData.dioramaBoundary=[A.minX,A.maxX,A.minZ,A.maxZ];material.userData.boardGrid=boardGrid(A);
  // The grid is world geometry expressed in the material, independent of raster UVs.
  // No generated/repainted textures, extra mesh, transparent overlay, or per-frame work.
  material.userData.boardSurface='natural-grass-earth-tiles-v1';material.map=null;material.color.set('#68734c');material.roughness=1;
  material.onBeforeCompile=shader=>{
   shader.uniforms.boardArena={value:arenaVector};shader.uniforms.boardGrid={value:gridVector};shader.uniforms.boardGridCount={value:gridCount};
   shader.vertexShader='varying vec2 boardPosition;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nboardPosition=position.xz;');
   shader.fragmentShader='varying vec2 boardPosition; uniform vec4 boardArena; uniform vec4 boardGrid; uniform vec2 boardGridCount;\n'+`
float boardHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float boardNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(boardHash(i),boardHash(i+vec2(1.0,0.0)),f.x),mix(boardHash(i+vec2(0.0,1.0)),boardHash(i+vec2(1.0,1.0)),f.x),f.y);}
`+shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
    vec2 boardCell=(boardPosition-boardGrid.xy)/boardGrid.z;
    vec2 boardCellEdge=min(boardCell,boardGridCount-boardCell)*boardGrid.z;
    float fieldEdge=min(boardCellEdge.x,boardCellEdge.y);
    float fieldInside=smoothstep(-.018,.018,fieldEdge);
    vec2 cellId=floor(clamp(boardCell,vec2(0.0),boardGridCount-vec2(.0001)));
    float tileSeed=boardHash(cellId+vec2(12.6,4.2));
    vec2 nearest=abs(fract(boardCell+.5)-.5)*boardGrid.z;
    vec2 aa=max(fwidth(boardPosition),vec2(.014));
    vec2 gridInk=vec2(1.0)-smoothstep(vec2(.014),vec2(.014)+aa*.8,nearest);
    float boardSeam=max(gridInk.x,gridInk.y)*fieldInside;
    float meadow=boardNoise(boardPosition*.25+vec2(3.7,8.1));
    float turf=boardNoise(boardPosition*.87+vec2(19.2,2.8));
    float grain=boardNoise(boardPosition*5.3);
    // Coherent patches cross cell joins. Gentle cell tint keeps the tactical tiles readable.
    float bareSoil=smoothstep(.52,.75,meadow*.76+turf*.24+tileSeed*.035);
    vec3 grass=mix(vec3(.057,.078,.029),vec3(.118,.147,.058),meadow*.67+turf*.33);
    vec3 soil=mix(vec3(.112,.074,.039),vec3(.165,.122,.067),turf);
    diffuseColor.rgb=mix(grass,soil,bareSoil)*( .95+tileSeed*.08+(grain-.5)*.11);
    // Sparse flat stone flecks are color, never hidden collision or artificial stepping blocks.
    vec2 chipCell=floor(boardPosition*1.35),chipLocal=fract(boardPosition*1.35)-.5;
    float chipSeed=boardHash(chipCell+vec2(27.1,2.7));
    float chipShape=length(chipLocal*vec2(1.0,1.5));
    float chips=(1.0-smoothstep(.085,.13,chipShape))*step(.88,chipSeed)*(.28+bareSoil*.3);
    diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.23,.21,.15),chips);
    diffuseColor.rgb*=1.0-boardSeam*(.07+turf*.11);
    float boardEdge=min(min(boardPosition.x-boardArena.x,boardArena.y-boardPosition.x),min(boardPosition.y-boardArena.z,boardArena.w-boardPosition.y));
    float boardBorder=1.0-smoothstep(-.04,.04,boardEdge);
    float edgeNoise=boardNoise(boardPosition*1.7);
    float verge=1.0-smoothstep(.05,.46+edgeNoise*.27,abs(boardEdge));
    vec3 apron=mix(vec3(.057,.048,.027),vec3(.117,.089,.047),meadow*.66+turf*.34)*(.87+grain*.24);
    float outsideVerge=smoothstep(0.0,.72+edgeNoise*.40,-boardEdge);
    diffuseColor.rgb=mix(diffuseColor.rgb,apron,outsideVerge*.80);
    // The legal line stays in its exact location; an irregular worn verge softens its appearance.
    diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.133,.106,.059),verge*(.28+edgeNoise*.15));
    float boardRule=1.0-smoothstep(.022,.065,abs(boardEdge));
    diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.040,.044,.025),boardRule*(.24+edgeNoise*.26));
    // board-surface-finish
   `);
  };material.customProgramCacheKey=()=> 'diorama-natural-grass-earth-v1';material.needsUpdate=true;
 }

 updateGeometry();
 return {root,get top(){return top;},get arena(){return Object.freeze({...A});},get grid(){return boardGrid(A);},setArena,styleGround,bindSurface(mesh){groundMeshes.add(mesh);updateSurface(mesh);},resources:{meshes:6,staticTextureBytes:bytes.byteLength,frameUpdates:0,rimJointInstances:36,rimJointTriangles:1368,edgeTriangles:960,frameAllocations:0},dispose(){if(disposed)return;disposed=true;root.removeFromParent();shadowMap.dispose();const geos=new Set(),mats=new Set();root.traverse(o=>{if(o.isMesh){geos.add(o.geometry);mats.add(o.material);}});for(const g of geos)g.dispose();for(const m of mats)m.dispose();groundMeshes.clear();groundMaterials.clear();}};
}

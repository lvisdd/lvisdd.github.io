// Visual-only, nonblocking and bounded: one shared texture per kind, no frame-time allocation.
export const IMPERIAL_TEXTURES=Object.freeze({
  ground:Object.freeze({file:'imperial-ground.png',repeat:[22,13.4]}),
  water:Object.freeze({file:'imperial-water.png',repeat:[55,33.5]}),
  timber:Object.freeze({file:'imperial-timber.png',repeat:[1,1]}),
  stone:Object.freeze({file:'imperial-stone.png',repeat:[1,1]})
});
const libraries=new WeakMap();
export function applyImperialTexture(THREE,material,kind,onReady=()=>{}){
  const spec=IMPERIAL_TEXTURES[kind];if(!spec)throw new Error('Unknown imperial surface: '+kind);
  let library=libraries.get(THREE);if(!library){library=new Map();libraries.set(THREE,library);}
  let entry=library.get(kind);
  if(!entry){entry={state:'loading',texture:null,targets:new Map()};library.set(kind,entry);
    // Promise wrapper also catches loaders unavailable in a headless/failure environment.
    entry.ready=Promise.resolve().then(()=>new THREE.TextureLoader().loadAsync('./assets/'+spec.file)).then(texture=>{
      texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(...spec.repeat);texture.anisotropy=2;
      texture.name='imperial-'+kind;entry.texture=texture;entry.state='ready';
      for(const [target,notify]of entry.targets){target.map=texture;target.needsUpdate=true;notify();}return true;
    }).catch(()=>{entry.state='fallback';return false;});
  }
  entry.targets.set(material,onReady);material.userData.imperialTexture=kind;
  if(entry.texture){material.map=entry.texture;material.needsUpdate=true;onReady();}
  return entry;
}

// Contrast belongs to the existing marks. Their geometry, extent and team fill are untouched.
function inkMaterial(material,shape,innerRatio=0,segmentedEnemy=false){
  const base=material.onBeforeCompile;
  material.userData.imperialInk={shape,innerRatio,segmentedEnemy};
  material.onBeforeCompile=shader=>{
    base?.(shader);shader.uniforms.imperialInner={value:innerRatio};
    shader.vertexShader='varying vec2 imperialMarkUv;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nimperialMarkUv=uv;');
    shader.fragmentShader='varying vec2 imperialMarkUv; uniform float imperialInner;\n'+shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      ${segmentedEnemy?'float imperialEnemy=step(diffuseColor.b,diffuseColor.r);':''}
      ${shape==='ring'?`float radius=length(imperialMarkUv-.5)*2.0;
      float band=max(.001,1.0-imperialInner);
      float core=smoothstep(imperialInner+band*.18,imperialInner+band*.30,radius)*(1.0-smoothstep(1.0-band*.30,1.0-band*.18,radius));`
      :`vec2 edges=min(imperialMarkUv,1.0-imperialMarkUv);
      float core=smoothstep(.008,.025,min(edges.x,edges.y));`}
      diffuseColor.rgb=mix(vec3(.02956,.02519,.01764),diffuseColor.rgb,core);
      diffuseColor.a=mix(.98,${shape==='ring'?'diffuseColor.a':'max(diffuseColor.a,.28)'},core);
      ${segmentedEnemy?`float sector=fract((atan(imperialMarkUv.y-.5,imperialMarkUv.x-.5)+3.14159265)/6.28318530*6.0);
      float segment=smoothstep(.02,.08,sector)*(1.0-smoothstep(.82,.88,sector));
      diffuseColor.a*=mix(1.0,segment,imperialEnemy);`:''}
    `);
  };
  material.customProgramCacheKey=()=> 'imperial-combat-ink-'+shape+(segmentedEnemy?'-team':'')+'-v1';material.needsUpdate=true;
}
export function applyImperialCombatInk(THREE,{scene,teamMarkers,aura}){
  inkMaterial(teamMarkers.material,'ring',.68/.88,true);inkMaterial(aura.material,'ring',1.62/1.68);
  scene.traverse(o=>{
    if(o.name==='attack-warning-lanes')inkMaterial(o.material,'lane');
    else if(o.name==='jump-warning-landings')inkMaterial(o.material,'ring',3.15/3.4);
    else if(o.isInstancedMesh&&o.geometry?.type==='RingGeometry'&&o.geometry.parameters.innerRadius===.95&&o.geometry.parameters.outerRadius===1.1)inkMaterial(o.material,'ring',.95/1.1);
  });
}

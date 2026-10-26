// Army combat uses one canonical cadence regardless of presentation frequency.
// The UI explicitly selects army; tutorials and existing callers retain the
// legacy variable-step contract, even if a lesson uses an army-shaped game. This does not make the
// engine's direct, variable-dt step API time-continuous.
export const ARMY_SIMULATION_STEP=1/60;
export const MAX_SIMULATION_CATCHUP=.25;
const clocks=new WeakMap(),ROUNDING_SLACK=1e-12;

// A callback re-evaluates click-to-step directions/distances after each step.
// The return value is elapsed SIMULATION time (zero on a held render frame).
// Render locomotion with that time, and preserve its pose when it is zero.
export function advanceSimulation(engine,game,elapsed,input,profile='legacy'){
 const duration=Math.min(MAX_SIMULATION_CATCHUP,Math.max(0,Number.isFinite(elapsed)?elapsed:0)),events=[];
 const fixed=profile==='army';let remaining=duration,steps=0,clock;
 if(fixed){
  clock=clocks.get(game);if(!clock){clock={remainder:0,motionElapsed:0};clocks.set(game,clock);}
  clock.remainder+=duration;clock.motionElapsed=0;
  // The tiny rounding allowance only repairs floating arithmetic at an exact
  // tick boundary. The carried remainder stays smaller than one tick.
  steps=Math.min(15,Math.floor((clock.remainder+ROUNDING_SLACK)/ARMY_SIMULATION_STEP));
  remaining=steps*ARMY_SIMULATION_STEP;
  clock.remainder=Math.max(0,clock.remainder-remaining);
 }
 const advanced=remaining;let budget=Number.isFinite(input?.maxDistance)?Math.max(0,input.maxDistance):Infinity;
 while(fixed?steps-->0:remaining>1e-9){
  const dt=fixed?ARMY_SIMULATION_STEP:Math.min(.05,remaining),dynamic=typeof input==='function';
  const controls=dynamic?input():{...input,maxDistance:budget},x=game.player?.x,z=game.player?.z;
  // A hitstop tick consumes clock time but moves no actors, including the
  // tick that reduces hitstop to zero. Observe only actual moving intervals.
  const frozen=game.hitstop>0;engine.step(game,dt,controls);
  if(fixed&&!frozen)clock.motionElapsed+=dt;
  if(!dynamic&&Number.isFinite(budget)&&Number.isFinite(x)&&Number.isFinite(z))budget=Math.max(0,budget-Math.hypot(game.player.x-x,game.player.z-z));
  events.push(...game.events);remaining-=dt;
 }
 // A no-step frame must not dispatch last frame's effects a second time.
 game.events=events;return advanced;
}
// Pause/reset/switch boundaries discard only the unconsumed fraction of a tick.
// Weak ownership avoids retaining a history of games or actors across retries.
advanceSimulation.reset=game=>{clocks.delete(game);};

advanceSimulation.motionElapsed=game=>clocks.get(game)?.motionElapsed||0;

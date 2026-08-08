///<reference types="svelte" />
;
import type { RunState } from '../../lib/types';

;type $$ComponentProps =  { run: RunState };function $$render() {

  

  let { run }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();

  /**
   * The one instrument on this page. Each node is a round; its ring fills with the share of
   * participants who reported nothing further to add, and the fill shifts coral → mint as
   * the panel aligns. It plots the exact quantity the tool exists to measure, which is why
   * it earns the space rather than a generic progress bar.
   */
  const rounds = $derived.by(() => {
    const participantIds = new Set(
      run.seats.filter((s) => s.role === 'participant').map((s) => s.seatId),
    );
    const out: Array<{ round: number; ratio: number; voted: number; total: number }> = [];
    for (let r = 1; r <= run.round; r++) {
      const turns = run.turns.filter((t) => t.round === r && participantIds.has(t.seatId));
      const total = turns.length;
      const voted = turns.filter((t) => t.converged === true).length;
      out.push({ round: r, ratio: total ? voted / total : 0, voted, total });
    }
    return out.reverse();
  });

  const R = 11;
  const C = 2 * Math.PI * R;

  function hue(ratio: number): string {
    if (ratio >= 0.999) return 'var(--agree)';
    if (ratio >= 0.5) return 'var(--open)';
    return 'var(--contest)';
  }
;
async () => {

 { svelteHTML.createElement("div", { "class":`rail`,});
   { svelteHTML.createElement("div", { "class":`label`,});  }
  if(!rounds.length){
     { svelteHTML.createElement("p", { "class":`empty data`,});   }
  }else{
     { svelteHTML.createElement("ol", {});
         for(let r of __sveltets_2_ensureArray(rounds)){r.round;
         { svelteHTML.createElement("li", {});
           { svelteHTML.createElement("svg", {       "viewBox":`0 0 28 28`,"width":`28`,"height":`28`,"aria-hidden":`true`,});
             { svelteHTML.createElement("circle", {            "cx":`14`,"cy":`14`,"r":R,"fill":`none`,"stroke":`var(--rule)`,"stroke-width":`2.5`,});}
             { svelteHTML.createElement("circle", {                   "cx":`14`,"cy":`14`,"r":R,"fill":`none`,"stroke":hue(r.ratio),"stroke-width":`2.5`,"stroke-linecap":`round`,"stroke-dasharray":`${C * r.ratio} ${C}`,"transform":`rotate(-90 14 14)`,});}
           }
           { svelteHTML.createElement("div", { "class":`meta`,});
             { svelteHTML.createElement("span", { "class":`rn`,}); r.round; }
             { svelteHTML.createElement("span", { "class":`data ratio`,});r.voted; r.total;  }
           }
         }
      }
     }
  }
 }


};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const ConvergenceRail__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type ConvergenceRail__SvelteComponent_ = ReturnType<typeof ConvergenceRail__SvelteComponent_>;
/*Ωignore_endΩ*/export default ConvergenceRail__SvelteComponent_;
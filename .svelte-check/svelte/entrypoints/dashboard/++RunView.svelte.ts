///<reference types="svelte" />
;
import { channelColor, seatStatusLabel } from '../../lib/channels';
import type { RunState } from '../../lib/types';
import ConvergenceRail from './ConvergenceRail.svelte';
import NarratorCard from './NarratorCard.svelte';

;type $$ComponentProps =  { run: RunState };function $$render() {

  
  
  
  

  let { run }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();

  const narratorId = $derived(run.seats.find((s) => s.role === 'narrator')?.seatId);

  /** Newest round first — the live edge is what you're watching. */
  const rounds = $derived.by(() => {
    const out: number[] = [];
    for (let r = run.round; r >= 1; r--) out.push(r);
    return out;
  });

  function turnsFor(round: number) {
    return run.turns.filter((t) => t.round === round && t.seatId !== narratorId);
  }
  function summaryFor(round: number) {
    return run.summaries.find((s) => s.round === round);
  }
  function focusTab(tabId: number) {
    void chrome.tabs.update(tabId, { active: true });
  }
;
async () => {

 { svelteHTML.createElement("div", { "class":`console`,});
   { svelteHTML.createElement("aside", { "class":`card side`,});
     { svelteHTML.createElement("div", { "class":`channels`,});
       { svelteHTML.createElement("div", { "class":`label`,});  }
       { svelteHTML.createElement("ul", {});
           for(let seat of __sveltets_2_ensureArray(run.seats)){seat.seatId;
           { svelteHTML.createElement("li", { });seat.status === 'dropped';
             { svelteHTML.createElement("span", {  "class":`swatch`,});__sveltets_2_ensureType(String, Number, channelColor(run, seat.seatId)); }
             { svelteHTML.createElement("button", {     "class":`jump`,"onclick":() => focusTab(seat.tabId),"title":`Open this model's tab`,});
              seat.displayName;
             }
             { svelteHTML.createElement("span", {     "class":`state data`,});seat.status === 'waiting' || seat.status === 'sending';seat.status === 'failed';seatStatusLabel(seat); }
            if(seat.role === 'narrator'){ { svelteHTML.createElement("span", { "class":`role label`,});  }}
           }
        }
       }
     }
     { const $$_liaRecnegrevnoC2C = __sveltets_2_ensureComponent(ConvergenceRail); new $$_liaRecnegrevnoC2C({ target: __sveltets_2_any(), props: { run,}});}
   }

   { svelteHTML.createElement("main", {});
    if(!rounds.length){
       { svelteHTML.createElement("p", { "class":`waiting`,});           }
    }

       for(let r of __sveltets_2_ensureArray(rounds)){r;
      const turns = turnsFor(r);
      const summary = summaryFor(r);
       { svelteHTML.createElement("section", { "class":`round`,});
         { svelteHTML.createElement("header", {});
           { svelteHTML.createElement("h3", {}); r; }
           { svelteHTML.createElement("span", { "class":`rule`,}); }
           { svelteHTML.createElement("span", { "class":`data count`,});turns.length;  run.seats.filter((s) => s.role === 'participant').length;  }
         }

        if(summary){
           { const $$_draCrotarraN3C = __sveltets_2_ensureComponent(NarratorCard); new $$_draCrotarraN3C({ target: __sveltets_2_any(), props: { summary,}});}
        } else if (r === run.round && run.status === 'running'){
           { svelteHTML.createElement("p", { "class":`pending data`,});    }
        }

         { svelteHTML.createElement("div", { "class":`turns`,});
             for(let t of __sveltets_2_ensureArray(turns)){t.seatId + t.round;
             { svelteHTML.createElement("article", {  "class":`card turn`,});__sveltets_2_ensureType(String, Number, channelColor(run, t.seatId));
               { svelteHTML.createElement("header", { "class":`th`,});
                 { svelteHTML.createElement("span", { "class":`who`,});t.displayName; }
                 { svelteHTML.createElement("span", { "class":`data meta`,});
                  t.wordCount;
                  if(t.converged === true){ { svelteHTML.createElement("span", { "class":`settled`,});  }
                  } else if (t.converged === null){ { svelteHTML.createElement("span", { "class":`novote`,});   }}
                  if(t.via === 'artifact'){ { svelteHTML.createElement("span", { "class":`art`,});   }}
                 }
               }
               { svelteHTML.createElement("details", {});
                 { svelteHTML.createElement("summary", {});    }
                 { svelteHTML.createElement("p", { "class":`body`,});t.text; }
               }
             }
          }
         }
       }
    }

    if(run.log.length){
       { svelteHTML.createElement("details", { "class":`log`,});
         { svelteHTML.createElement("summary", {});  }
         { svelteHTML.createElement("ul", {});
              for(let e of __sveltets_2_ensureArray([...run.log].reverse())){let i = 1;e.at + i;
             { svelteHTML.createElement("li", {   "class":`data`,});e.level === 'warn';e.level === 'error';
               { svelteHTML.createElement("span", { "class":`ts`,});e.at.slice(11, 19); }e.message;
             }
          }
         }
       }
    }
   }
 }


};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const RunView__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type RunView__SvelteComponent_ = ReturnType<typeof RunView__SvelteComponent_>;
/*Ωignore_endΩ*/export default RunView__SvelteComponent_;
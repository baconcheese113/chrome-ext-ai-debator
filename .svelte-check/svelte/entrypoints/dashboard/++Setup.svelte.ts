///<reference types="svelte" />
;
import { onMount } from 'svelte';
import type { CandidateTab, ConvergenceStrategy, RunConfig, Seat } from '../../lib/types';

;type $$ComponentProps =  { onstart: (c: RunConfig, s: Array<Omit<Seat, 'status'>>) => void };function $$render() {

  
  

  let { onstart }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();

  let tabs = $state<CandidateTab[]>([]);
  let loading = $state(true);
  /** tabId -> assignment. Absent means the tab sits this run out. */
  let roles = $state<Record<number, 'participant' | 'narrator' | 'none'>>({});
  let names = $state<Record<number, string>>({});

  let topic = $state('');
  let maxRounds = $state(6);
  let convergence = $state<ConvergenceStrategy>('self-report');
  let autoDrop = $state(false);
  let wordBudget = $state(400);

  async function load() {
    loading = true;
    tabs = await chrome.runtime.sendMessage({ type: 'LIST_TABS' });
    for (const t of tabs) {
      roles[t.tabId] ??= 'none';
      names[t.tabId] ??= t.providerLabel;
    }
    loading = false;
  }

  async function diagnose(tabId: number) {
    const d = await chrome.runtime.sendMessage({ type: 'DIAGNOSE_TAB', tabId });
    // Copying beats rendering here: the output's only job is to be pasted somewhere useful.
    await navigator.clipboard.writeText(JSON.stringify(d, null, 2));
    diagnosed = tabId;
    setTimeout(() => (diagnosed = null), 2500);
  }
  let diagnosed = $state<number | null>(null);

  const participants = $derived(tabs.filter((t) => roles[t.tabId] === 'participant'));
  const narrators = $derived(tabs.filter((t) => roles[t.tabId] === 'narrator'));

  const problem = $derived.by(() => {
    if (!topic.trim()) return 'Give the panel a topic.';
    if (participants.length < 2) return 'Seat at least two participants.';
    if (narrators.length > 1) return 'Only one narrator.';
    if (convergence === 'moderator' && narrators.length === 0)
      return 'Moderator convergence needs a narrator seat.';
    return null;
  });

  function start() {
    const seats = [...participants, ...narrators].map((t) => ({
      seatId: `seat-${t.tabId}`,
      tabId: t.tabId,
      providerId: t.providerId,
      displayName: names[t.tabId]?.trim() || t.providerLabel,
      role: roles[t.tabId] as 'participant' | 'narrator',
    }));
    onstart({ topic: topic.trim(), maxRounds, convergence, autoDrop, wordBudget }, seats);
  }

  // onMount, not $effect: load() writes to state it also reads, and an effect would risk
  // re-running itself.
  onMount(load);
;
async () => {

 { svelteHTML.createElement("div", { "class":`wrap`,});
   { svelteHTML.createElement("section", { "class":`card patch`,});
     { svelteHTML.createElement("header", {});
       { svelteHTML.createElement("div", {});
         { svelteHTML.createElement("h2", {});   }
         { svelteHTML.createElement("p", { "class":`hint`,});
                           
                     
         }
       }
       { svelteHTML.createElement("button", { "onclick":load,});  }
     }

    if(loading){
       { svelteHTML.createElement("p", { "class":`empty data`,});   }
    } else if (!tabs.length){
       { svelteHTML.createElement("p", { "class":`empty`,});
                       
       }
    }else{
       { svelteHTML.createElement("ul", {});
           for(let t of __sveltets_2_ensureArray(tabs)){t.tabId;
           { svelteHTML.createElement("li", { });roles[t.tabId] !== 'none';
             { svelteHTML.createElement("div", { "class":`who`,});
               { svelteHTML.createElement("span", { "class":`prov`,});t.providerLabel; }
               { svelteHTML.createElement("span", {   "class":`title`,"title":t.title,});t.title || t.url; }
             }
             { svelteHTML.createElement("input", {         "class":`name`,"bind:value":names[t.tabId],"aria-label":`Name shown to the other models`,"placeholder":`Name shown to others`,});/*Ωignore_startΩ*/() => names[t.tabId] = __sveltets_2_any(null);/*Ωignore_endΩ*/}
             { svelteHTML.createElement("select", {   "bind:value":roles[t.tabId],"aria-label":`Seat role`,});/*Ωignore_startΩ*/() => roles[t.tabId] = __sveltets_2_any(null);/*Ωignore_endΩ*/
               { svelteHTML.createElement("option", { "value":`none`,});   }
               { svelteHTML.createElement("option", { "value":`participant`,});  }
               { svelteHTML.createElement("option", { "value":`narrator`,});  }
             }
             { svelteHTML.createElement("button", {   "class":`diag`,"onclick":() => diagnose(t.tabId),});
              diagnosed === t.tabId ? 'Copied' : 'Diagnose';
             }
           }
        }
       }
       { svelteHTML.createElement("p", { "class":`foot`,});
                      
            
       }
    }
   }

   { svelteHTML.createElement("section", { "class":`card config`,});
     { svelteHTML.createElement("h2", {});  }

     { svelteHTML.createElement("div", { "class":`field`,});
       { svelteHTML.createElement("label", {   "class":`label`,"for":`topic`,});  }
       { svelteHTML.createElement("textarea", {        "id":`topic`,"bind:value":topic,"rows":3,"placeholder":`What should the panel brainstorm?`,});/*Ωignore_startΩ*/() => topic = __sveltets_2_any(null);/*Ωignore_endΩ*/ }
     }

     { svelteHTML.createElement("div", { "class":`grid`,});
       { svelteHTML.createElement("div", { "class":`field`,});
         { svelteHTML.createElement("label", {   "class":`label`,"for":`rounds`,});  }
         { svelteHTML.createElement("input", {          "id":`rounds`,"type":`number`,"min":`1`,"max":`20`,"bind:value":maxRounds,});/*Ωignore_startΩ*/() => maxRounds = __sveltets_2_any(null);/*Ωignore_endΩ*/}
       }
       { svelteHTML.createElement("div", { "class":`field`,});
         { svelteHTML.createElement("label", {   "class":`label`,"for":`budget`,});   }
         { svelteHTML.createElement("input", {            "id":`budget`,"type":`number`,"min":`80`,"max":`2000`,"step":`20`,"bind:value":wordBudget,});/*Ωignore_startΩ*/() => wordBudget = __sveltets_2_any(null);/*Ωignore_endΩ*/}
       }
     }

     { svelteHTML.createElement("div", { "class":`field`,});
       { svelteHTML.createElement("label", {   "class":`label`,"for":`conv`,});  }
       { svelteHTML.createElement("select", {   "id":`conv`,"bind:value":convergence,});/*Ωignore_startΩ*/() => convergence = __sveltets_2_any(null);/*Ωignore_endΩ*/
         { svelteHTML.createElement("option", { "value":`self-report`,});     }
         { svelteHTML.createElement("option", { "value":`moderator`,});     }
         { svelteHTML.createElement("option", { "value":`manual`,});     }
       }
     }

     { svelteHTML.createElement("label", { "class":`check`,});
       { svelteHTML.createElement("input", {    "type":`checkbox`,"bind:checked":autoDrop,});/*Ωignore_startΩ*/() => autoDrop = __sveltets_2_any(null);/*Ωignore_endΩ*/}
       { svelteHTML.createElement("span", {});            }
     }

     { svelteHTML.createElement("div", { "class":`go`,});
       { svelteHTML.createElement("button", {     "class":`primary`,"disabled":!!problem,"onclick":start,});  }
      if(problem){ { svelteHTML.createElement("span", { "class":`problem`,});problem; }}
     }
   }
 }


};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Setup__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Setup__SvelteComponent_ = ReturnType<typeof Setup__SvelteComponent_>;
/*Ωignore_endΩ*/export default Setup__SvelteComponent_;
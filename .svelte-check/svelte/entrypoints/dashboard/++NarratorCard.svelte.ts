///<reference types="svelte" />
;
import type { RoundSummary } from '../../lib/types';

;type $$ComponentProps =  { summary: RoundSummary };function $$render() {

  
  let { summary }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
;
async () => {

 { svelteHTML.createElement("div", { "class":`card narr`,});
  if(summary.parseError){
     { svelteHTML.createElement("p", { "class":`err`,});
                  
       { svelteHTML.createElement("span", { "class":`data`,});summary.parseError; }
     }
     { svelteHTML.createElement("details", {}); { svelteHTML.createElement("summary", {});    } { svelteHTML.createElement("pre", { "class":`data`,});summary.raw; } }
  }else{
    if(summary.rationale){ { svelteHTML.createElement("p", { "class":`rationale`,});summary.rationale; }}

     { svelteHTML.createElement("div", { "class":`cols`,});
       { svelteHTML.createElement("section", { "class":`agree`,});
         { svelteHTML.createElement("h4", { "class":`label`,});  }
        if(summary.agreements.length){
           { svelteHTML.createElement("ul", {});    for(let a of __sveltets_2_ensureArray(summary.agreements)){let i = 1;i; { svelteHTML.createElement("li", {});a; }} }
        }else{ { svelteHTML.createElement("p", { "class":`none`,});  }}
       }

       { svelteHTML.createElement("section", { "class":`contest`,});
         { svelteHTML.createElement("h4", { "class":`label`,});  }
        if(summary.disagreements.length){
           { svelteHTML.createElement("ul", {});    for(let d of __sveltets_2_ensureArray(summary.disagreements)){let i = 1;i; { svelteHTML.createElement("li", {});d; }} }
        }else{ { svelteHTML.createElement("p", { "class":`none`,});  }}
       }

       { svelteHTML.createElement("section", { "class":`open`,});
         { svelteHTML.createElement("h4", { "class":`label`,});  }
        if(summary.openQuestions.length){
           { svelteHTML.createElement("ul", {});    for(let q of __sveltets_2_ensureArray(summary.openQuestions)){let i = 1;i; { svelteHTML.createElement("li", {});q; }} }
        }else{ { svelteHTML.createElement("p", { "class":`none`,});  }}
       }
     }

    if(summary.keyPoints.length){
       { svelteHTML.createElement("details", { "class":`points`,});
         { svelteHTML.createElement("summary", {});   }
            for(let kp of __sveltets_2_ensureArray(summary.keyPoints)){let i = 1;kp.agent + i;
           { svelteHTML.createElement("div", { "class":`kp`,}); { svelteHTML.createElement("span", { "class":`who`,});kp.agent; }
             { svelteHTML.createElement("ul", {});    for(let p of __sveltets_2_ensureArray(kp.points)){let j = 1;j; { svelteHTML.createElement("li", {});p; }} }
           }
        }
       }
    }
  }
 }


};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const NarratorCard__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type NarratorCard__SvelteComponent_ = ReturnType<typeof NarratorCard__SvelteComponent_>;
/*Ωignore_endΩ*/export default NarratorCard__SvelteComponent_;
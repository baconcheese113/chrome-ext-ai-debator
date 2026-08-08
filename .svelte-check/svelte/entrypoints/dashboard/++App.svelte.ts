///<reference types="svelte" />
;
import { onMount } from 'svelte';
import { EMPTY_RUN, getRun } from '../../lib/store';
import type { RunConfig, RunState, Seat } from '../../lib/types';
import RunView from './RunView.svelte';
import Setup from './Setup.svelte';
function $$render() {

  
  
  
  
  

  let run = $state<RunState>(EMPTY_RUN);

  // storage.onChanged rather than polling: the orchestrator writes state as it goes, so the
  // console tracks the run without a timer. onMount, not $effect — this subscribes to an
  // external source and depends on no reactive state.
  onMount(() => {
    void getRun().then((r) => (run = r));
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes.runState?.newValue) {
        run = changes.runState.newValue as RunState;
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  });

  const showSetup = $derived(run.status === 'idle' || run.status === 'aborted' || !run.seats.length);

  function start(config: RunConfig, seats: Array<Omit<Seat, 'status'>>) {
    void chrome.runtime.sendMessage({ type: 'START_RUN', config, seats });
  }
  const send = (type: string, extra: object = {}) =>
    void chrome.runtime.sendMessage({ type, ...extra });

  const statusText: Record<RunState['status'], string> = {
    idle: 'Ready',
    running: 'Running',
    paused: 'Paused',
    done: 'Finished',
    aborted: 'Stopped',
    error: 'Error',
  };
;
async () => {

 { svelteHTML.createElement("div", { "class":`shell`,});
   { svelteHTML.createElement("header", { "class":`top`,});
     { svelteHTML.createElement("div", { "class":`brand`,});
       { svelteHTML.createElement("span", {   "class":`mark`,"aria-hidden":`true`,}); }
       { svelteHTML.createElement("h1", {});  }
     }

    if(run.config.topic){
       { svelteHTML.createElement("p", {   "class":`topic`,"title":run.config.topic,});run.config.topic; }
    }else{
       { svelteHTML.createElement("p", { "class":`topic muted`,});   }
    }

     { svelteHTML.createElement("div", { "class":`status`,});
       { svelteHTML.createElement("span", { "class":`chip ${run.status}`,});statusText[run.status]; }
      if(run.status === 'running' || run.status === 'paused'){
         { svelteHTML.createElement("span", { "class":`data round`,}); run.round;  run.config.maxRounds; }
         { svelteHTML.createElement("button", { "onclick":() => send('MARK_CONVERGED'),});    }
         { svelteHTML.createElement("button", {   "class":`danger`,"onclick":() => send('STOP_RUN'),});  }
      } else if (!showSetup){
         { svelteHTML.createElement("button", { "onclick":() => send('RESET_RUN'),});  }
      }
     }
   }

  if(run.incident){
    
     { svelteHTML.createElement("div", {   "class":`incident`,"role":`alert`,});
       { svelteHTML.createElement("div", {});
         { svelteHTML.createElement("strong", {});run.incident.displayName;     run.incident.round;  }
         { svelteHTML.createElement("span", { "class":`data why`,});run.incident.failure;  run.incident.detail; }
       }
       { svelteHTML.createElement("div", { "class":`acts`,});
         { svelteHTML.createElement("button", { "onclick":() => send('RESOLVE_INCIDENT', { action: 'retry' }),});  }
         { svelteHTML.createElement("button", { "onclick":() => send('RESOLVE_INCIDENT', { action: 'drop' }),});   }
         { svelteHTML.createElement("button", {   "class":`danger`,"onclick":() => send('RESOLVE_INCIDENT', { action: 'abort' }),});   }
       }
     }
  }

   { svelteHTML.createElement("div", { "class":`body`,});
    if(showSetup){
       { const $$_puteS2C = __sveltets_2_ensureComponent(Setup); new $$_puteS2C({ target: __sveltets_2_any(), props: {  "onstart":start,}});}
    }else{
       { const $$_weiVnuR2C = __sveltets_2_ensureComponent(RunView); new $$_weiVnuR2C({ target: __sveltets_2_any(), props: { run,}});}
    }
   }
 }


};
return { props: {} as Record<string, never>, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const App__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type App__SvelteComponent_ = ReturnType<typeof App__SvelteComponent_>;
/*Ωignore_endΩ*/export default App__SvelteComponent_;
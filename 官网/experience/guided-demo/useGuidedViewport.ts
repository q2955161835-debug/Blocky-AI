import { useEffect } from 'react';
import { Blockly } from '../../../packages/ui-editor/src/blocks';
import type { Workspace } from '../../../packages/language-schema/src/index';

/** Guide the actual canvas to the current step instead of centering a wide stack. */
export function useGuidedViewport(active:boolean,focusId:string|undefined,workspace:Workspace) {
  useEffect(()=>{
    if(!active||!focusId||!matchMedia('(max-width:900px)').matches)return;
    const original=new Map<Blockly.Field,number>();
    const frame=requestAnimationFrame(()=>{
      const editor=Blockly.common.getAllWorkspaces().find(value=>value instanceof Blockly.WorkspaceSvg&&value.getBlockById(focusId)) as Blockly.WorkspaceSvg|undefined;
      if(!editor)return;
      // Keep values intact. Only shorten the text shown in narrow, guided views.
      for(const block of editor.getAllBlocks(false))for(const input of block.inputList)for(const field of input.fieldRow)if(field instanceof Blockly.FieldTextInput){
        original.set(field,field.maxDisplayLength);field.maxDisplayLength=28;field.forceRerender();
      }
      const targetId=focusId==='assistant-tool-loop'?'assistant-tool-1':focusId==='assistant-root'&&editor.getBlockById('assistant-remember-delivery')?'assistant-remember-delivery':focusId;
      const target=editor.getBlockById(targetId);
      if(!target)return;
      editor.setScale(0.72);
      const position=target.getRelativeToSurfaceXY(),view=editor.getMetricsManager().getViewMetrics(true);
      editor.scroll(editor.scrollX+(view.left-position.x)*editor.scale+18,editor.scrollY+(view.top-position.y)*editor.scale+22);
    });
    return ()=>{
      cancelAnimationFrame(frame);
      for(const [field,length] of original){field.maxDisplayLength=length;if(field.getSourceBlock())field.forceRerender();}
    };
  },[active,focusId,workspace]);
}

import { Blockly, registerBlocks } from '../../packages/ui-editor/src/blocks';
import * as En from 'blockly/msg/en';
import * as Zh from 'blockly/msg/zh-hans';
import { getPreferences, subscribePreferences, translate } from '../dist/preferences.js';
const labels=new WeakMap<Blockly.Field,string>();
const options=new WeakMap<Blockly.FieldDropdown,Blockly.MenuOption[]>();
function localizeBlock(block:Blockly.Block) {
  for(const input of block.inputList)for(const field of input.fieldRow) {
    if(field instanceof Blockly.FieldDropdown) {
      if(!options.has(field))options.set(field,field.getOptions(false));
      const value=field.getValue();
      field.setOptions(options.get(field)!.map(option=>Array.isArray(option)?[typeof option[0]==='string'?translate(option[0]):option[0],option[1],option[2]]:option));
      field.setValue(value);
    } else if(field instanceof Blockly.FieldLabel && !field.name) {
      if(!labels.has(field))labels.set(field,String(field.getValue()));
      field.setValue(translate(labels.get(field)!));
    }
  }
}
export function installCanvasLocalization() {
  registerBlocks();
  for(const definition of Object.values(Blockly.Blocks)) {
    const original=definition.init;
    if(!original)continue;
    definition.init=function(this:Blockly.Block) {original.call(this);localizeBlock(this);};
  }
  const update=()=>{
    Blockly.setLocale(Object.fromEntries(Object.entries(getPreferences().resolvedLanguage==='en'?En:Zh).filter((entry):entry is [string,string]=>typeof entry[1]==='string')));
    Blockly.Events.disable();
    try { for(const workspace of Blockly.common.getAllWorkspaces())for(const block of workspace.getAllBlocks(false))localizeBlock(block); }
    finally {Blockly.Events.enable();}
  };
  update();subscribePreferences(update);
  // The shared overview is a snapshot. Refresh only its rendered labels from
  // actual blocks, so edited field values remain verbatim in either language.
  const updateOutline=()=>{
    for(const button of document.querySelectorAll<HTMLButtonElement>('.canvas-outline button[title]')) {
      const block=Blockly.common.getAllWorkspaces().map(workspace=>workspace.getBlockById(button.title)).find(Boolean);
      const label=button.querySelector('span');
      if(block&&label){label.setAttribute('data-no-translate','');const value=block.toString(80);if(label.textContent!==value)label.textContent=value;}
    }
  };
  new MutationObserver(updateOutline).observe(document.body,{subtree:true,childList:true,characterData:true});
  subscribePreferences(updateOutline);
}

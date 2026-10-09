import { beginnerCategories, categories } from '../../packages/block-catalog/src/index';
import { catalog, startingBlueprints, type BlueprintId } from './data';
import { BlueprintDock } from '../../apps/studio-desktop/src/app/BlueprintDock';
const projection = [0,1,1,2,3,4,5,5,5,5,5,6];
export function DemoLibrary({view, setView, add, start, search}: {
  view: 'beginner'|'professional'; setView(value:'beginner'|'professional'):void;
  add(type:string):void; start(id:BlueprintId|'blank'):void; search():void;
}) {
  return <aside className="library">
    <div className="sidebar-heading">积木库<button aria-label="搜索积木" onClick={search}>⌕</button></div>
    <div className="view-switch">{(['beginner','professional'] as const).map((id,i)=><button key={id} className={view===id?'active':''} onClick={()=>setView(id)}>{i?'专业':'入门'}</button>)}</div>
    <div className="palette">{(view==='beginner'?beginnerCategories:categories).map((name,i)=>{
      const blocks=catalog.filter(b=>(view==='beginner'?projection[b.category]:b.category)===i);
      return <section key={name}><h3><span style={{background:blocks[0]?.color}}/>{name}</h3>{blocks.map(b=><button className="palette-block" key={b.type} style={{borderLeftColor:b.color}} onClick={()=>add(b.type)}>{b.label}<span>＋</span></button>)}</section>;
    })}</div>
    <BlueprintDock><div className="module-list"><div className="section-label">个人蓝图</div><p className="muted">选择积木后可保存为蓝图</p><button disabled>导入蓝图</button><div className="section-label">项目画布</div><span>主画布</span><div className="section-label">内置起始蓝图</div>{startingBlueprints.map(b=><button key={b.id} onClick={()=>start(b.id)}>{b.displayName}</button>)}<button onClick={()=>start('blank')}>新建空白项目</button></div></BlueprintDock>
  </aside>;
}

import { beginnerCategories, categories } from '../../packages/block-catalog/src/index';
import { catalog, startingBlueprints, type BlueprintId } from './data';
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
    <div className="module-list"><div className="section-label">内置起始蓝图</div>{startingBlueprints.map(b=><button key={b.id} onClick={()=>start(b.id)}>新建：{b.displayName}</button>)}<button onClick={()=>start('blank')}>新建空白项目</button></div>
  </aside>;
}

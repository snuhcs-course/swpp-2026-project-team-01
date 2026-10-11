import type {Page} from '@playwright/test';
export async function workspaceNavigate(page:Page,name:'Meeting requests'|'Close meeting requests'|'Host chat'){
 await page.getByRole('button',{name:'Workspace menu',exact:true}).click();
 await page.getByRole('menuitem',{name,exact:true}).click();
}

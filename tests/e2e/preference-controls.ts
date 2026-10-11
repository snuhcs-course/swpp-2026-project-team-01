import {expect,type Page} from '@playwright/test';

export async function openPreferenceControls(page:Page){
 const trigger=page.getByRole('region',{name:'Your meeting setup'}).getByRole('button',{name:'Adjust preferences',exact:true});
 await expect(trigger).toBeVisible();
 if(await trigger.getAttribute('aria-expanded')!=='true')await trigger.click();
}

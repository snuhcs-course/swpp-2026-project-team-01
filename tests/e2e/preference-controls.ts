import {expect,type Page} from '@playwright/test';

export async function openPreferenceControls(page:Page){
 const trigger=page.getByRole('region',{name:'Your meeting setup'}).getByRole('button',{name:'Adjust preferences',exact:true});
 await expect(trigger).toBeVisible();
 await expect(page.getByRole('region',{name:'Your meeting setup'}).locator('[data-streaming="true"]')).toHaveCount(0);
 if(await trigger.getAttribute('aria-expanded')!=='true')await trigger.click();
 await expect(trigger).toHaveAttribute('aria-expanded','true');
}

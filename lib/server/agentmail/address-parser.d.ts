declare module 'nodemailer/lib/addressparser/index.js' {
 type Mailbox={address?:string;name?:string;group?:Mailbox[]};
 export default function parse(value:string,options?:{flatten?:boolean}):Mailbox[];
}

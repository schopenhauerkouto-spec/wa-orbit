export class MetaCloudTransport {
  constructor({accessToken, phoneNumberId, apiVersion="v23.0", fetchImpl=fetch}) {
    if (!accessToken || !phoneNumberId) throw new Error("META_WHATSAPP_CREDENTIALS_REQUIRED");
    this.accessToken=accessToken;
    this.phoneNumberId=phoneNumberId;
    this.apiVersion=apiVersion;
    this.fetch=fetchImpl;
    this.baseUrl=`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;
  }

  async send({phone,body}) {
    const response=await this.fetch(this.baseUrl,{
      method:"POST",
      headers:{
        Authorization:`Bearer ${this.accessToken}`,
        "Content-Type":"application/json"
      },
      body:JSON.stringify({
        messaging_product:"whatsapp",
        recipient_type:"individual",
        to:phone,
        type:"text",
        text:{preview_url:false,body}
      })
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok){
      const message=data?.error?.message||`Meta API ${response.status}`;
      throw new Error(message);
    }
    return {id:data?.messages?.[0]?.id||null,raw:data};
  }
}

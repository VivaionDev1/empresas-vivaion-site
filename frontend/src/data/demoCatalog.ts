/** Illustrative records only. Never treat them as synchronized commercial offers. */
export type SiteProduct = {
  id: string;
  slug: string;
  kind: "pos" | "formacao" | "curso-livre";
  title: string;
  summary: string;
  area: string;
  commercialStage: "available" | "prelaunch" | "closed";
  deliveryMode: string;
  canonicalUrl: string;
  audienceLabel: string;
};

export const demoCatalog: SiteProduct[] = [
  {
    id: "pos:posfati", slug: "posfati", kind: "pos",
    title: "Fala Motora, Apraxia e Tecnologias de Intervenção",
    summary: "Pós-graduação voltada à atuação em fala motora e tecnologias clínicas.",
    area: "Fonoaudiologia", commercialStage: "available", deliveryMode: "recorded",
    canonicalUrl: "https://vivaion.com.br/pos-graduacao/posfati/",
    audienceLabel: "Profissionais com formação específica"
  },
  {
    id: "pos:saude-mental-riscos-psicossociais", slug: "saude-mental-riscos-psicossociais", kind: "pos",
    title: "Saúde Mental e Riscos Psicossociais",
    summary: "Estudos relacionados a saúde mental, organizações e contexto do trabalho.",
    area: "Saúde mental", commercialStage: "prelaunch", deliveryMode: "live",
    canonicalUrl: "https://vivaion.com.br/pos-graduacao/ao-vivo/saude-mental-riscos-psicossociais/",
    audienceLabel: "Verificar pré-requisitos acadêmicos"
  },
  {
    id: "formacao:neurociencia-afetiva", slug: "neurociencia-afetiva", kind: "formacao",
    title: "Neurociência Afetiva",
    summary: "Formação especializada em neurociência e sistemas emocionais.",
    area: "Neurociência", commercialStage: "available", deliveryMode: "online",
    canonicalUrl: "https://vivaion.com.br/formacoes/neurociencia-afetiva/",
    audienceLabel: "Profissionais da saúde mental"
  },
  {
    id: "curso-livre:iddsi-na-pratica", slug: "iddsi-na-pratica", kind: "curso-livre",
    title: "IDDSI na Prática",
    summary: "Curso livre para atualização profissional e aplicação clínica.",
    area: "Fonoaudiologia", commercialStage: "available", deliveryMode: "online",
    canonicalUrl: "https://vivaion.com.br/cursos-livres/iddsi-na-pratica/",
    audienceLabel: "Verificar requisitos na página oficial"
  }
];

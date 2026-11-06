// Valores falsos só para os testes. Nunca coloque dados reais aqui.
const fake = {
  TZ_NAME: 'America/Bogota', // UTC-5 o ano todo, sem horário de verão
  OWNER_NAME: 'Fulano',
  INSTITUICAO_PADRAO: 'UFX',
  AREAS: 'Faculdade,Trabalho,Dev,Pessoal,Estudos',
  AREA_TRABALHO: 'Trabalho',
  CLIMA_LAT: '4.71',
  CLIMA_LON: '-74.07',
  ALIAS_MATERIAS: JSON.stringify({
    estatistica: 'Estatística Computacional',
    so: 'Sistemas Operacionais',
    ed: 'Estrutura de Dados',
    lp: 'Linguagem de Programação II',
    lp2: 'Linguagem de Programação II',
    'lp ii': 'Linguagem de Programação II',
    sad: 'Sistemas de Apoio à Decisão',
    socio: 'Sociologia',
    ingles: 'Inglês',
  }),
  NOTION_PERFIL_ID: 'perfil-page',
};
for (const k of ['perfil', 'materias', 'projetos', 'livros', 'avaliacoes', 'tarefas', 'notas', 'diario', 'lancamentos', 'recompensas', 'ficha_treino', 'areas']) {
  fake[`NOTION_DS_${k.toUpperCase()}`] = `ds-${k}`;
}
Object.assign(process.env, fake);

import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, User } from 'lucide-react';
import TimelineEvent from '@/components/TimelineEvent';
import StatusBadge from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';

const processoData = {
  numero: '0001234-56.2025.8.26.0100',
  vara: '1ª Vara Cível — Foro Central — São Paulo/SP',
  status: 'Em andamento',
  classe: 'Procedimento Comum Cível',
  assunto: 'Indenização por Dano Moral',
  valor: 'R$ 50.000,00',
  cliente: { nome: 'Maria Silva', cpf: '123.456.789-00', email: 'maria@email.com', telefone: '(11) 99999-0000' },
  movimentacoes: [
    { date: '09/02/2026 14:30', title: 'Despacho publicado', description: 'O juiz determinou intimação para manifestação em 15 dias úteis. Prazo começará a contar a partir da publicação no DJe.', type: 'important' as const },
    { date: '01/02/2026 10:00', title: 'Petição intermediária protocolada', description: 'Petição com documentos complementares foi juntada aos autos digitais. Aguardando análise do juízo.', type: 'default' as const },
    { date: '20/01/2026 08:45', title: 'Audiência de conciliação realizada', description: 'As partes não chegaram a um acordo. O juiz determinou a continuidade do processo com apresentação de provas.', type: 'default' as const },
    { date: '10/01/2026 11:30', title: 'Citação do réu', description: 'O réu foi citado por meio eletrônico e apresentou contestação no prazo legal.', type: 'default' as const },
    { date: '15/12/2025 09:00', title: 'Distribuição do processo', description: 'Processo distribuído à 1ª Vara Cível do Foro Central de São Paulo. Juiz designado: Dr. Fernando Almeida.', type: 'default' as const },
  ],
};

export default function ProcessoDetail() {
  const { id } = useParams();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/processos">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
          </Button>
        </Link>
      </div>

      {/* Header */}
      <div className="card-elevated p-6">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-xl font-bold font-mono">{processoData.numero}</h1>
              <StatusBadge variant="info">{processoData.status}</StatusBadge>
            </div>
            <p className="text-sm text-muted-foreground">{processoData.vara}</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
              <div>
                <p className="text-xs text-muted-foreground">Classe</p>
                <p className="text-sm font-medium">{processoData.classe}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Assunto</p>
                <p className="text-sm font-medium">{processoData.assunto}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Valor da Causa</p>
                <p className="text-sm font-medium">{processoData.valor}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Timeline */}
        <div className="lg:col-span-2 card-elevated p-6">
          <h3 className="text-lg font-semibold mb-4">Movimentações</h3>
          <div className="space-y-0">
            {processoData.movimentacoes.map((m, i) => (
              <TimelineEvent
                key={i}
                date={m.date}
                title={m.title}
                description={m.description}
                type={m.type}
                isLast={i === processoData.movimentacoes.length - 1}
              />
            ))}
          </div>
        </div>

        {/* Client info */}
        <div className="card-elevated p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <User className="h-5 w-5 text-accent" /> Cliente
          </h3>
          <div className="space-y-3">
            <div>
              <p className="text-xs text-muted-foreground">Nome</p>
              <p className="text-sm font-medium">{processoData.cliente.nome}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">CPF</p>
              <p className="text-sm font-mono">{processoData.cliente.cpf}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">E-mail</p>
              <p className="text-sm">{processoData.cliente.email}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Telefone</p>
              <p className="text-sm">{processoData.cliente.telefone}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

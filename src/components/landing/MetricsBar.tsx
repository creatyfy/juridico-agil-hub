import { useCountUp } from '@/hooks/useScrollReveal';

const metrics = [
  { end: 2400, suffix: '+', label: 'Advogados ativos', prefix: '' },
  { end: 98, suffix: '%', label: 'Satisfação', prefix: '' },
  { end: 180, suffix: 'k', label: 'Processos gerenciados', prefix: '' },
  { end: 3, suffix: '×', label: 'Mais produtividade', prefix: '' },
];

function MetricItem({ end, suffix, label, prefix }: typeof metrics[0]) {
  const { ref, value } = useCountUp(end, 2000);
  return (
    <div ref={ref} className="py-8 md:py-10 text-center px-4">
      <p className="text-3xl md:text-4xl font-extrabold bg-gradient-to-r from-[#3a7dff] to-[#00d4ff] bg-clip-text text-transparent">
        {prefix}{value.toLocaleString('pt-BR')}{suffix}
      </p>
      <p className="text-sm text-white/40 mt-1 font-medium">{label}</p>
    </div>
  );
}

export default function MetricsBar() {
  return (
    <section className="relative bg-[#040d1a] border-y border-white/5">
      <div className="container mx-auto px-4 md:px-8">
        <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-white/5">
          {metrics.map((m, i) => (
            <MetricItem key={i} {...m} />
          ))}
        </div>
      </div>
    </section>
  );
}

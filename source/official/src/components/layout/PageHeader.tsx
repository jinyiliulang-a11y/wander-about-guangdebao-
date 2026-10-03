interface PageHeaderProps {
  eyebrow: string;
  title: string;
  highlight?: string;
  description?: string;
  dark?: boolean;
}

export default function PageHeader({
  eyebrow,
  title,
  highlight,
  description,
  dark = false,
}: PageHeaderProps) {
  return (
    <section
      className={`relative pt-36 pb-20 lg:pt-44 lg:pb-28 overflow-hidden ${
        dark ? "bg-navy-950 text-cream-100" : "bg-cream-100 text-navy-950"
      }`}
    >
      {dark && (
        <>
          <div className="absolute inset-0 grid-bg-dark opacity-20" />
          <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-forest-400/10 rounded-full blur-[120px]" />
        </>
      )}
      {!dark && (
        <>
          <div className="absolute inset-0 grid-bg opacity-50" />
          <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-forest-400/5 rounded-full blur-[100px]" />
        </>
      )}

      <div className="container relative">
        <div className="reveal max-w-4xl">
          <span
            className={`font-mono text-sm tracking-wider ${
              dark ? "text-forest-400" : "text-forest-600"
            }`}
          >
            {eyebrow}
          </span>
          <h1 className="font-display font-bold text-4xl md:text-6xl lg:text-7xl mt-4 leading-[1.05]">
            {title}
            {highlight && (
              <>
                <br />
                <span
                  className={
                    dark ? "gradient-text-forest italic" : "text-stroke-navy"
                  }
                >
                  {highlight}
                </span>
              </>
            )}
          </h1>
          {description && (
            <p
              className={`mt-8 text-lg md:text-xl leading-relaxed max-w-2xl ${
                dark ? "text-cream-100/60" : "text-navy-800/60"
              }`}
            >
              {description}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

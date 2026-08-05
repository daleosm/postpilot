import { featureSections } from "../lib/content";

export function FeatureSections() {
  return (
    <>
      {featureSections.map((feature, index) => (
        <section id={feature.id} className={`section feature-section feature-section--${index % 2 === 0 ? "image-right" : "image-left"}`} aria-labelledby={`${feature.id}-title`} key={feature.id}>
          <div className="feature-section__copy">
            <p className="section-kicker">{feature.kicker}</p>
            <h2 id={`${feature.id}-title`} className="section-title">{feature.title}</h2>
            <div className="feature-section__detail"><p className="feature-section__label">Operational problem</p><p>{feature.problem}</p></div>
            <div className="feature-section__detail feature-section__detail--result"><p className="feature-section__label">Practical result</p><p>{feature.result}</p></div>
          </div>
          <a className="feature-shot" href={feature.image} target="_blank" rel="noreferrer" aria-label={`Open the ${feature.kicker} product screenshot`}>
            <picture>
              <source srcSet={feature.image} type="image/webp" />
              <img src={feature.fallback} alt={feature.alt} width="1035" height="648" loading={index === 0 ? "eager" : "lazy"} decoding="async" />
            </picture>
            <span>Open real product screen <b aria-hidden="true">↗</b></span>
          </a>
        </section>
      ))}
    </>
  );
}

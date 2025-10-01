"use client";

import { useTranslations } from 'next-intl';
import { Scissors, Wand2, Share2, Zap, Users, Code } from "lucide-react";

export default function Features() {
  const t = useTranslations('landing.features');
  
  const features = [
    {
      icon: Scissors,
      title: t('preciseEditing.title'),
      description: t('preciseEditing.description'),
    },
    {
      icon: Wand2,
      title: t('aiGenerated.title'),
      description: t('aiGenerated.description'),
    },
    {
      icon: Share2,
      title: t('exportAnywhere.title'),
      description: t('exportAnywhere.description'),
    },
    {
      icon: Code,
      title: t('openSource.title'),
      description: t('openSource.description'),
    },
  ];
  
  return (
    <section id="features" className="py-20 border-t border-white/10">
      <div className="container mx-auto px-4">
        <div className="max-w-2xl mx-auto text-center mb-16">
          <h2 className="text-3xl font-bold mb-4">
            {t('title')}
          </h2>
          <p className="text-gray-400">
            {t('subtitle')}
          </p>
        </div>

        <div className="max-w-screen-md mx-auto grid grid-cols-1 md:grid-cols-2 gap-8">
          {features.map((feature, index) => (
            <div
              key={index}
              className="p-6 rounded-lg border border-white/10 bg-gradient-to-b from-white/5 to-transparent hover:border-white/20 transition-colors"
            >
              <feature.icon className="w-12 h-12 mb-4 text-white/80" />
              <h3 className="text-xl font-semibold mb-2">{feature.title}</h3>
              <p className="text-gray-400">{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

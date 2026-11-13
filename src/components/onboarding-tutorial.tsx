'use client';

import React, { useState } from 'react';
import {
  Sunrise,
  MessageCircle,
  GlassWater,
  CalendarDays,
  Sliders,
  Sparkles,
  ArrowRight,
  CheckCircle2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { OutreachInlinePrompt } from '@/components/outreach-inline-prompt';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface OnboardingTutorialProps {
  onComplete: () => void;
  isOpen: boolean;
}

const steps = [
  {
    title: 'Welcome to Your Coaster',
    description:
      "I'm Sunny, your non-drinking booth-buddy. There are no grades or lectures here—just a calm, honest place to tally standard drink units and notice your rhythm.",
    icon: <Sunrise className="w-11 h-11 text-[#C26D2D]" />,
  },
  {
    title: 'Talk, Snap, or Shorthand',
    description:
      'In the Sunny tab, tell me what you had in plain English, tap the mic, upload bottle or bar menu photos, or open Hybrid Shorthand for ultra-fast entries like "2x 12oz 5%".',
    icon: <MessageCircle className="w-11 h-11 text-[#C26D2D]" />,
  },
  {
    title: 'One-Tap Pours & Clear Days',
    description:
      'In Today, see your Standard Drink Units (12oz 5% beer, 5oz 12% wine, or 1.5oz 40% spirit = 1.0u), tap quick presets, or celebrate an alcohol-free evening with Clear Day.',
    icon: <GlassWater className="w-11 h-11 text-[#3F7D58]" />,
  },
  {
    title: 'Spot Patterns Over Time',
    description:
      "Trends brings together your daily tally + 7-day average, Monday–Sunday rhythm, 90-day Coaster calendar heatmap, and Sunny's 30-Day Trend Spotter.",
    icon: <CalendarDays className="w-11 h-11 text-[#D97706]" />,
  },
  {
    title: 'Private On-Device & Email Too',
    description:
      'Keep quick parses local with Chrome Gemini Nano & Privacy Vault, adjust swap preferences in Settings, or turn on gentle Morning & Evening email check-ins below.',
    icon: <Sliders className="w-11 h-11 text-[#3F7D58]" />,
  },
];

export function OnboardingTutorial({ onComplete, isOpen }: OnboardingTutorialProps) {
  const [currentStep, setCurrentStep] = useState(0);

  const nextStep = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      onComplete();
    }
  };

  const skip = () => {
    onComplete();
  };

  const step = steps[currentStep];

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onComplete()}>
      <DialogContent className="sm:max-w-[460px] bg-[#FFFDF9] border-[#E8DFD1] text-[#1F1B18] shadow-2xl rounded-3xl p-7">
        <DialogHeader className="sr-only">
          <DialogTitle>{step.title}</DialogTitle>
        </DialogHeader>

        <div className="absolute top-4 right-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={skip}
            className="rounded-full text-[#6E6359] hover:text-[#1F1B18] hover:bg-[#FAF6F0]"
            aria-label="Close orientation"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex flex-col items-center text-center space-y-6 pt-3">
          <div className="p-5 bg-[#FAF6F0] border border-[#E8DFD1] rounded-3xl shadow-inner animate-in zoom-in duration-300">
            {step.icon}
          </div>

          <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <h2 className="text-2xl font-semibold tracking-tight text-[#1F1B18] font-['Newsreader',Georgia,serif]">
              {step.title}
            </h2>
            <p className="text-sm sm:text-base text-[#6E6359] leading-relaxed px-1">
              {step.description}
            </p>
          </div>

          <div className="flex items-center gap-1.5 pt-1">
            {steps.map((_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === currentStep ? 'w-8 bg-[#C26D2D]' : 'w-2 bg-[#E8DFD1]'
                }`}
              />
            ))}
          </div>

          {currentStep === steps.length - 1 && (
            <div className="w-full text-left">
              <OutreachInlinePrompt variant="onboarding" />
            </div>
          )}

          <div className="w-full pt-2 space-y-2">
            <Button
              onClick={nextStep}
              className="w-full h-12 rounded-2xl text-sm font-semibold bg-[#C26D2D] hover:bg-[#A85B22] text-[#FFFDF9] shadow-md"
            >
              <span className="flex items-center justify-center gap-2">
                {currentStep === steps.length - 1 ? (
                  <>
                    Start With Sunny
                    <CheckCircle2 className="w-4 h-4" />
                  </>
                ) : (
                  <>
                    Next
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </span>
            </Button>

            {currentStep === 0 && (
              <Button
                variant="ghost"
                onClick={skip}
                className="w-full text-xs font-medium text-[#6E6359] hover:text-[#1F1B18]"
              >
                <Sparkles className="w-3.5 h-3.5 mr-1.5 text-[#D97706]" />
                Skip straight to my coaster
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

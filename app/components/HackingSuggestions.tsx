"use client";

const DEFAULT_QUESTION = "What are we testing today?";

export const HackingSuggestions = () => {
  return (
    <div className="relative mb-4 flex flex-col items-center px-4 text-center md:mb-6">
      <h1 className="flex items-center gap-1 text-xl font-medium leading-none text-foreground sm:text-2xl md:gap-0 md:text-3xl">
        <span className="min-h-6 pt-0.5 tracking-tight sm:min-h-7 md:min-h-8 md:pt-0">
          {DEFAULT_QUESTION}
        </span>
      </h1>
    </div>
  );
};

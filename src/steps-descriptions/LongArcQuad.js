import { Dumbbell, User, ArrowDownUp, Settings2 } from "lucide-react";

export default function LongArcQuadSetup() {
    return (
        <div className="max-w-2xl mx-auto p-5 bg-white rounded-2xl shadow-md space-y-6">
            {/* Title */}
            <h2 className="text-xl font-bold text-gray-900">
                🦵 Long Arc Quad – Setup Guide
            </h2>

            {/* Equipment */}
            <div className="bg-blue-50 p-4 rounded-lg flex flex-col gap-2">
                <div className="flex items-center justify-center space-x-2">
                    <Dumbbell className="w-5 h-5 text-blue-600" />
                    <h3 className="text-base font-semibold text-gray-800">Equipment</h3>
                </div>
                <p className="text-sm text-gray-600">
                    A stable chair or bench to sit on. Optional: ankle weights for added resistance.
                </p>
            </div>

            {/* Stance */}
            <div className="bg-green-50 p-4 rounded-lg flex flex-col gap-2">
                <div className="flex items-center justify-center space-x-2">
                    <User className="w-5 h-5 text-blue-600" />
                    <h3 className="text-base font-semibold text-gray-800">Stance</h3>
                </div>
                <p className="text-sm text-gray-600">
                    Sit tall on the chair with feet flat on the floor and knees bent at a comfortable angle. Keep your back straight.
                </p>
            </div>

            {/* Direction */}
            <div className="bg-yellow-50 p-4 rounded-lg flex flex-col gap-2">
                <div className="flex items-center justify-center space-x-2">
                    <ArrowDownUp className="w-5 h-5 text-blue-600" />
                    <h3 className="text-base font-semibold text-gray-800">Movement Direction</h3>
                </div>
                <p className="text-sm text-gray-600">
                    Slowly extend one leg forward until it is straight, then lower it back down. Repeat with the other leg. Keep movement smooth and controlled.
                </p>
            </div>

            {/* Basic Setup */}
            <div className="bg-purple-50 p-4 rounded-lg flex flex-col gap-2">
                <div className="flex items-center justify-center space-x-2">
                    <Settings2 className="w-5 h-5 text-blue-600" />
                    <h3 className="text-base font-semibold text-gray-800">Basic Setup</h3>
                </div>
                <ul className="space-y-2 text-sm text-gray-600 text-left">
                    <li className="before:content-['•'] before:mr-2 before:text-purple-600">Sit upright with your back straight and core engaged.</li>
                    <li className="before:content-['•'] before:mr-2 before:text-purple-600">Extend one leg fully while keeping the knee and ankle aligned.</li>
                    <li className="before:content-['•'] before:mr-2 before:text-purple-600">Lower the leg slowly to starting position without slamming it down.</li>
                    <li className="before:content-['•'] before:mr-2 before:text-purple-600">Alternate legs and maintain smooth, controlled movements.</li>
                </ul>
            </div>
        </div>
    );
}

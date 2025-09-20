import { User, ArrowDownUp, Settings2, Armchair } from "lucide-react";

export default function SitToStandSetup() {
    return (
        <div className="max-w-2xl mx-auto p-5 bg-white rounded-2xl shadow-md space-y-6">
            {/* Title */}
            <h2 className="text-xl font-bold text-gray-900 text-center">
                🪑 Sit to Stand – Setup Guide
            </h2>

            {/* Equipment */}
            <div className="bg-blue-50 p-4 rounded-lg flex flex-col gap-2">
                <div className="flex items-center justify-center space-x-2">
                    <Armchair className="w-5 h-5 text-blue-600" />
                    <h3 className="text-base font-semibold text-gray-800">Equipment</h3>
                </div>
                <p className="text-sm text-gray-600 text-center">
                    A stable chair with no wheels. Optional: use armrests for support if needed.
                </p>
            </div>

            {/* Stance */}
            <div className="bg-green-50 p-4 rounded-lg flex flex-col gap-2">
                <div className="flex items-center justify-center space-x-2">
                    <User className="w-5 h-5 text-green-600" />
                    <h3 className="text-base font-semibold text-gray-800">Stance</h3>
                </div>
                <p className="text-sm text-gray-600 text-center">
                    Sit upright on the chair with feet flat on the floor and knees at a <span className="font-medium">90-degree angle</span>.
                </p>
            </div>

            {/* Direction */}
            <div className="bg-yellow-50 p-4 rounded-lg flex flex-col gap-2">
                <div className="flex items-center justify-center space-x-2">
                    <ArrowDownUp className="w-5 h-5 text-yellow-600" />
                    <h3 className="text-base font-semibold text-gray-800">Movement Direction</h3>
                </div>
                <p className="text-sm text-gray-600 text-center">
                    Lean forward slightly, push through your heels, and <span className="font-medium">stand up</span>.
                    Slowly return to <span className="font-medium">sit down</span> with control.
                </p>
            </div>

            {/* Basic Setup */}
            <div className="bg-purple-50 p-4 rounded-lg flex flex-col gap-3">
                <div className="flex items-center justify-center space-x-2">
                    <Settings2 className="w-5 h-5 text-purple-600" />
                    <h3 className="text-base font-semibold text-gray-800">Basic Setup</h3>
                </div>
                <ul className="space-y-2 text-sm text-gray-600 text-left">
                    <li className="before:content-['•'] before:mr-2 before:text-purple-600">Keep your back straight and core engaged while leaning forward.</li>
                    <li className="before:content-['•'] before:mr-2 before:text-purple-600">Push through your heels to stand, not your toes.</li>
                    <li className="before:content-['•'] before:mr-2 before:text-purple-600">Use armrests if needed for balance, but aim to reduce reliance gradually.</li>
                    <li className="before:content-['•'] before:mr-2 before:text-purple-600">Perform movement slowly to avoid jerking or losing balance.</li>
                </ul>
            </div>
        </div>
    );
}
